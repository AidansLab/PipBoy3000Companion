const packageJson = require('./package.json');

// Strip off the `.0` from the version if it exists
let displayVersion = packageJson.version;
if (displayVersion.endsWith('.0')) {
  displayVersion = displayVersion.slice(0, -2);
}

module.exports = {
  appId: "com.fallout.pipboy.sync",
  productName: "Pip-Boy Sync",
  icon: "build/icon.ico",
  directories: {
    output: "release"
  },
  files: [
    "src/**/*",
    "electron/**/*",
    "data/**/*",
    "build/**/*",
    "icon.png",
    "package.json"
  ],
  extraResources: [
    {
      from: "../FW",
      to: "FW",
      filter: ["FW Build/**/*.JS"]
    }
  ],
  win: {
    target: [
      {
        target: "portable",
        arch: ["x64"]
      }
    ],
    signAndEditExecutable: false,
    artifactName: `\${productName} ${displayVersion}.\${ext}`
  }
};
