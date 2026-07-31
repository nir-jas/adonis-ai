import { FsLoader } from "@adonisjs/core/ace";

const loader = new FsLoader(
  import.meta.dirname,
  (filePath) => !filePath.endsWith("main.js"),
);

export const getMetaData = loader.getMetaData.bind(loader);
export const getCommand = loader.getCommand.bind(loader);
