module.exports = {
  appId: "com.fallout.pipboy.sync",
  productName: "Pip-Boy_Sync",
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
    },
    {
      from: "../fixed-maps",
      to: "fixed-maps",
      filter: ["**/*.MAP"]
    },
    {
      from: "../fixed-maps-f3",
      to: "fixed-maps-f3",
      filter: ["**/*.MAP"]
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
