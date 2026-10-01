import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer ?? Buffer;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerRootComponent } = require("expo") as typeof import("expo");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const App = (require("./App") as typeof import("./App")).default;

registerRootComponent(App);
