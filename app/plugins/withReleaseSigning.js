// Signs release builds with Nelta's own key instead of the template's public debug key.
// Every published APK must use the same key, or Android refuses the in-app update. See RELEASING.md.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_SIGNING = `        release {
            def storePath = System.getenv('NELTA_RELEASE_STORE_FILE')
            if (storePath) {
                storeFile file(storePath)
                storePassword System.getenv('NELTA_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('NELTA_RELEASE_KEY_ALIAS')
                keyPassword System.getenv('NELTA_RELEASE_KEY_PASSWORD')
            }
        }
`;

const RELEASE_BUILD_TYPE =
  "signingConfig System.getenv('NELTA_ALLOW_DEBUG_SIGNED_RELEASE') == '1' ? signingConfigs.debug : signingConfigs.release";

const RELEASE_GUARD = `
tasks.matching { it.name == 'preReleaseBuild' }.configureEach {
    doFirst {
        if (!System.getenv('NELTA_RELEASE_STORE_FILE') && System.getenv('NELTA_ALLOW_DEBUG_SIGNED_RELEASE') != '1') {
            throw new GradleException("Release builds need Nelta's release key: set NELTA_RELEASE_STORE_FILE and friends (see RELEASING.md).")
        }
    }
}
`;

function apply(gradle) {
  if (gradle.includes("NELTA_RELEASE_STORE_FILE")) return gradle;
  const withConfig = gradle.replace(/(signingConfigs \{\n)(\s*debug \{[^}]*\}\n)/, `$1$2${RELEASE_SIGNING}`);
  const withBuildType = withConfig.replace(
    /(\n\s*release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
    `$1${RELEASE_BUILD_TYPE}`,
  );
  if (withConfig === gradle || withBuildType === withConfig) {
    throw new Error("withReleaseSigning: android/app/build.gradle no longer matches the expected template");
  }
  return withBuildType + RELEASE_GUARD;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = apply(c.modResults.contents);
    return c;
  });
