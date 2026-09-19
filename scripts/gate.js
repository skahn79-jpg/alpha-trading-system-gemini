"use strict";
const path = require("node:path");
const { runCli } = require("../tools/gate-runner");
runCli({ argv: process.argv.slice(2), repoRootHint: path.resolve(__dirname, ".."), execPath: process.execPath })
  .then((code) => { process.exit(code); })
  .catch((err) => { process.stderr.write(String(err && err.message ? err.message : err) + "\n"); process.exit(3); });
