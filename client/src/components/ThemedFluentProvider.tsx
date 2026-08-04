import type { ReactNode } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { lightTheme, darkTheme } from "../theme";
import { useThemeMode } from "../hooks/useThemeMode";

export function ThemedFluentProvider({ children }: { children: ReactNode }) {
    const { mode } = useThemeMode();

    return (
        <FluentProvider theme={mode === "dark" ? darkTheme : lightTheme}>
            {children}
        </FluentProvider>
    );
}
