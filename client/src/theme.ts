import { webLightTheme, webDarkTheme, type Theme } from "@fluentui/react-components";

// webLightTheme's brand ramp is already the Microsoft "communication blue"
// (#0078D4) used by the legacy server-rendered pages, so reusing it keeps
// the same accent color without inventing a new palette.
export const lightTheme: Theme = webLightTheme;
export const darkTheme: Theme = webDarkTheme;
