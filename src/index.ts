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

export const figmaDownload = async (args: Arguments) => {
  const { FIGMA_API_PAT: personalAccessToken } = process.env;
  const api = new Figma.Api({
    personalAccessToken,
  });
  const { team, format, output, project } = args;
  await fs.mkdir(output, { recursive: true }).catch(() => ({})); // dir存在チェックのため
  const tasks = new Listr([
    {
      title: "get projects by team",
      skip: () => {
        if (team === "") {
          return "skip because -t has not been passed.";
        }
      },
      task: (ctx) => {
        ctx.projects = [];
        ctx.projectsCache = false;
        ctx.files = {};
        ctx.filesCache = false;
        return new Listr([
          {
            title: "check cache",
            task: async (ctx) => {
              const data = await fs
                .readFile(`${output}/teamprojects_${team}.${format}`, "utf8")
                .catch(() => {
                  return "";
                });
              if (data) {
                if (format === "json") {
                  ctx.projects = JSON.parse(data);
                } else {
                  const records = await csvtojson().fromString(data);
                  ctx.projects = records;
                }
                ctx.projectsCache = true;
              }
            },
          },
          {
            title: "fetch",
            task: async (ctx) => {
              const data = await api.getTeamProjects(team);
              ctx.projects = data;
              return Promise.resolve();
            },
            skip: (ctx) => {
              if (ctx.projects) {
                return "skip because exist cache";
              }
            },
          },
          {
            title: "save",
            task: async (ctx) => {
              const data =
                format === "json"
                  ? JSON.stringify(ctx.projects.projects)
                  : await json2csv.json2csvAsync(ctx.projects.projects);
              await fs.writeFile(
                `${output}/teamprojects_${team}.${format}`,
                data,
                "utf8"
              );
            },
            skip: (ctx) => {
              if (ctx.projectsCache) {
                return "skip because exist cache";
              }
            },
          },
        ]);
      },
    },
    {
      title: "get file by project",
      skip: (ctx) => {
        if (!(ctx.projects || project)) {
          return "skip because -t or -p has not been passed";
        }
      },
      task: () => {
        return new Listr([
          {
            title: "fetch",
            task: async (ctx) => {
              const queue = new PQueue({ concurrency: 1 });
              return new Listr(
                ctx.projects.map(({ id }) => {
                  return {
                    title: `fetcing file by project id ${id}`,
                    task: async (ctx) => {
                      await queue.add(async () => {
                        const data = await api.getProjectFiles(id);
                        ctx.files[id] = data;
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
            title: "save",
            task: async (ctx) => {
              await fs.writeFile(
                `${output}/files_${team}.${format}`,
                JSON.stringify(ctx.files),
                "utf8"
              );
            },
          },
        ]);
      },
    },
  ]);
  tasks.run();
};
