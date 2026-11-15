import React, { forwardRef } from "react";
import type { VisualizerSharedProps } from "../.work/src/components/visualizer/definition";
import LyricStageFit from "./LyricStageFit";
// Native controls own navigation. Keep the original renderer's ref and layout box.
const VisualizerShell = forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    className?: string;
    theme: any;
    audioPower: any;
    audioBands: any;
    sharedProps?: Partial<VisualizerSharedProps> & { nativeStageMode?: string };
    renderBackground?: boolean;
    visualizerOpacity?: number;
  }
>(
  (
    { children, className = "", theme, sharedProps, visualizerOpacity = 1 },
    ref,
  ) => (
    <div
      ref={ref}
      data-folia-stage-shell
      className={
        "absolute inset-0 flex flex-col items-center justify-center overflow-hidden " +
        className
      }
      style={{
        color: theme.primaryColor,
        fontFamily: theme.fontFamily || "system-ui,sans-serif",
        opacity: sharedProps?.visualizerOpacity ?? visualizerOpacity,
      }}
    >
      {React.Children.map(children, (child) => {
        const fitLyrics = ["classic", "partita", "tilt"].includes(
          sharedProps?.nativeStageMode ?? "",
        );
        if (
          fitLyrics &&
          React.isValidElement<{
            className?: string;
            children?: React.ReactNode;
          }>(child) &&
          child.props.className?.split(" ").includes("h-[70vh]")
        ) {
          return React.cloneElement(child, {
            children: <LyricStageFit>{child.props.children}</LyricStageFit>,
          });
        }
        return child;
      })}
    </div>
  ),
);
export default VisualizerShell;
