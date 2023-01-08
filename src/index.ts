import Listr from "listr";
import PQueue from "p-queue";
import * as Figma from "figma-api";
import { promises as fs } from "fs";
import json2csv from "json-2-csv";
import csvtojson from "csvtojson";

export interface Arguments {
  team: string;
  project: string;
  file: string;
  output: string;
  format: string;
}

const writeFile = async (path, format, data) => {
  await fs.writeFile(
    path,
    format === "json"
      ? JSON.stringify(data)
      : await json2csv.json2csvAsync(data),
    "utf8"
  );
};

const readFile = async (path, format) => {
  const data = await fs.readFile(path, "utf8").catch(() => "");
  if (data === "") {
    return data;
  }
  if (format === "json") {
    return JSON.parse(data);
  }
  if (format === "csv") {
    return await csvtojson().fromString(data);
  }
  return "";
};

export const figmaDownload = async (args: Arguments) => {
  const { FIGMA_API_PAT: personalAccessToken } = process.env;
  const api = new Figma.Api({
    personalAccessToken,
  });
  const { team, format, output, project } = args;
  await fs.mkdir(output, { recursive: true }).catch(() => ({}));

  const tasks = new Listr([
    {
      title: "Prepare",
      task: (ctx) => {
        ctx.projects = [];
        ctx.projectsCache = false;
        ctx.files = [];
        ctx.filesCache = false;
        ctx.nodes = [];
      },
    },
    {
      title: "Get team projects by team",
      skip: () => {
        if (team === "") {
          return "skip because -t has not been passed.";
        }
      },
      task: () => {
        return new Listr([
          {
            title: "Check cache",
            task: async (ctx) => {
              const data = await readFile(
                `${output}/team_projects_by_team_${team}.${format}`,
                format
              );
              if (data) {
                ctx.projects = data;
                ctx.projectsCache = true;
              }
            },
          },
          {
            title: "Fetch",
            skip: (ctx) => {
              if (ctx.projectsCache) {
                return "Skip because exist cache";
              }
            },
            task: async (ctx) => {
              const data = await api.getTeamProjects(team);
              ctx.projects = data.projects.map((p) => ({
                ...p,
                team_id: team,
              }));
              return Promise.resolve();
            },
          },
          {
            title: "Save",
            skip: (ctx) => {
              if (ctx.projectsCache) {
                return "skip because exist cache";
              }
            },
            task: async (ctx) => {
              await writeFile(
                `${output}/team_projects_by_team_${team}.${format}`,
                format,
                ctx.projects
              );
            },
          },
        ]);
      },
    },
    {
      title: "Get project files by project",
      skip: (ctx) => {
        if (!(ctx.projects || project)) {
          return "skip because -t or -p has not been passed";
        }
      },
      task: () => {
        return new Listr([
          {
            title: "Check cache",
            task: async (ctx) => {
              const projectIds = project
                ? [project]
                : ctx.projects.map((p) => p.id);
              const projectFiles = await Promise.all(
                projectIds.map(async (id) => {
                  return await readFile(
                    `${output}/project_files_by_project_${id}.${format}`,
                    format
                  );
                })
              );
              const projectFilesFlat = projectFiles.flat();
              if (projectFilesFlat.every((d) => d !== "")) {
                ctx.files = projectFiles;
                ctx.filesCache = true;
              }
            },
          },
          {
            title: "Fetch",
            skip: (ctx) => {
              if (ctx.filesCache) {
                return "Skip because exist cache";
              }
            },
            task: async (ctx) => {
              const queue = new PQueue({ concurrency: 1 });
              const projectIds = project
                ? [project]
                : ctx.projects.map((p) => p.id);
              return new Listr(
                projectIds.map((id) => {
                  return {
                    title: `Fetching project_files by project id ${id}`,
                    task: async (ctx) => {
                      await queue.add(async () => {
                        const data = await api.getProjectFiles(id);
                        const innerData = data.files.map((f) => ({
                          ...f,
                          project_id: id,
                        }));
                        ctx.files.push(innerData);
                        return Promise.resolve();
                      });
                    },
                  };
                }),
                { concurrent: true }
              );
            },
          },
          {
            title: "Save",
            skip: (ctx) => {
              if (ctx.filesCache) {
                return "Skip because exist cache";
              }
            },
            task: async (ctx) => {
              await Promise.all(
                ctx.files.map(async (f) => {
                  await writeFile(
                    `${output}/project_files_by_project_${f[0].project_id}.${format}`,
                    format,
                    f
                  );
                })
              );
            },
          },
        ]);
      },
    },
    {
      title: "Get detail file by file",
      skip: (ctx) => {
        if (!(ctx.files || args.file)) {
          return "skip because -t or -p or -f has not been passed.";
        }
      },
      task: () => {
        return new Listr([
          {
            title: "Fetch",
            task: async (ctx) => {
              const projectFiles = args.file
                ? [[{ key: args.file, project_id: 0 }]]
                : ctx.files;
              const queue = new PQueue({ concurrency: 1 });
              return new Listr(
                projectFiles.map((files) => {
                  return {
                    title: `Fetching file by project_id ${files[0].project_id}`,
                    task: () => {
                      return new Listr(
                        files.map((file) => {
                          return {
                            title: `Fetch by file id $${file.key}`,
                            skip: async () => {
                              const data = await readFile(
                                `${output}/file_by_file_${file.key}.${format}`,
                                format
                              );
                              if (data !== "") {
                                return "Skip because exist cache";
                              }
                            },
                            task: async (ctx) => {
                              await queue.add(async () => {
                                const data = await api
                                  .getFile(file.key)
                                  .catch(async (error) => {
                                    if (error.response.status === 500) {
                                      const retryData = await api.getFile(
                                        file.key,
                                        { depth: 1 }
                                      );
                                      const {
                                        document: { children },
                                      } = retryData;
                                      retryData.document.children =
                                        await Promise.all(
                                          children.map(async (child) => {
                                            const innerData = await api.getFile(
                                              file.key,
                                              {
                                                ids: [child.id],
                                              }
                                            );
                                            const {
                                              document: {
                                                children: innerChildrenData,
                                              },
                                            } = innerData;
                                            return innerChildrenData.find(
                                              (c) => c.id === child.id
                                            );
                                          })
                                        );
                                      return retryData;
                                    }
                                  });
                                data["id"] = file.key;
                                ctx.nodes.push(data);
                                return Promise.resolve();
                              });
                            },
                          };
                        }),
                        { concurrent: true }
                      );
                    },
                  };
                }),
                { concurrent: true }
              );
            },
          },
          {
            title: "Save",
            task: async (ctx) => {
              ctx.nodes.map((node) => {
                writeFile(
                  `${output}/file_by_file_${node.id}.${format}`,
                  format,
                  node
                );
              });
            },
          },
        ]);
      },
    },
  ]);
  tasks.run();
};
