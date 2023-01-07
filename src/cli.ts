import { Command } from "commander";
import * as dotenv from "dotenv";
dotenv.config();

import { figmaDownload } from "./index.js";

const program = new Command();
program
  .version("0.0.0")
  .option("-t, --team [type]", "Figma Team", "")
  .option("-p, --project [type]", "Figma Project", "")
  .option("-f, --file [type]", "Figma File", "")
  .option("-o, --output [type]", "Output dir", "./out")
  .option("-fm, --format [type]", "Output file format. json or csv", "csv")
  .parse(process.argv);

const options = program.opts();
figmaDownload({
  team: options.team,
  project: options.project,
  file: options.file,
  output: options.output,
  format: options.format,
});
