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
      filter: ["FW Build/**/*.JS", "FW Build/.boot0"]
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
    artifactName: "${productName}.${ext}"
  }
};
