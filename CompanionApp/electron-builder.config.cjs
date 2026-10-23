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
  },
  linux: {
    // Single-file AppImage, the Windows portable build's counterpart; also
    // runs on the Steam Deck. The serialport native binding is NAPI and ships
    // linux-x64/arm64 prebuilds, so no compile step is needed (the build:linux
    // script passes --config.npmRebuild=false for that reason).
    target: [
      {
        target: "AppImage",
        arch: ["x64"]
      }
    ],
    icon: "build/icon.png",
    category: "Utility",
    artifactName: "${productName}.${ext}"
  }
};
