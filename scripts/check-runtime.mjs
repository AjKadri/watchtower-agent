const requestedVersion = process.argv[2] ?? process.versions.node;
const major = Number.parseInt(requestedVersion.split(".")[0] ?? "", 10);

if (major !== 24) {
  process.stderr.write(
    `Unsupported Node.js runtime ${requestedVersion}. Watchtower requires Node.js 24.x. Run \`nvm use\` before installing dependencies.\n`,
  );
  process.exit(1);
}
