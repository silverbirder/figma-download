csvを無視しよう

const teamProjects = withCache(key, () => getTeamProjects(team));
listrのskip?

cache is json
↓ 並列 (Listr)

getProjectFiles(project)
getFiles(project)
getFileNodes(file)

連携
ctx に teamID, projectID, fileID
使い終わったら、delete
