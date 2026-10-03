import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer ?? Buffer;

// Required after the polyfills so web3.js sees them when routes load.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("expo-router/entry");
