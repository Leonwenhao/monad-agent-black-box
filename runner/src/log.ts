const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m"
};

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(color: keyof typeof ANSI, text: string): string {
  return useColor ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

export function info(message: string): void {
  process.stdout.write(`${paint("cyan", "[runner]")} ${message}\n`);
}

export function step(message: string): void {
  process.stdout.write(`${paint("dim", "[runner]")} ${message}\n`);
}

export function ok(message: string): void {
  process.stdout.write(`${paint("green", "[runner:ok]")} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${paint("yellow", "[runner:warn]")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${paint("red", paint("bold", "[runner:FAILED]"))} ${message}\n`);
}
