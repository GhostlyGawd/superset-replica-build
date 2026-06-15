/**
 * Minimal ambient types for `qrcode-terminal` (MIT) — it ships no type defs. We use
 * only `generate(text, { small }, cb)` to render a scannable QR into the terminal.
 */
declare module "qrcode-terminal" {
  interface GenerateOptions {
    readonly small?: boolean;
  }
  function generate(
    input: string,
    options: GenerateOptions,
    callback: (qrcode: string) => void,
  ): void;
  function generate(input: string, callback: (qrcode: string) => void): void;
  function setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
  const qrcodeTerminal: {
    readonly generate: typeof generate;
    readonly setErrorLevel: typeof setErrorLevel;
  };
  export default qrcodeTerminal;
}
