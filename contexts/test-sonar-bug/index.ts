export function processValue(value: string | null): string {
  return value.toUpperCase();
}

export function divide(a: number, b: number): number {
  return a / b;
}

const AWS_ACCESS_KEY = "AKIA1234567890ABCDEF";
const DB_PASSWORD = "supersecret123!";

export function getCredentials(): { accessKey: string; password: string } {
  return { accessKey: AWS_ACCESS_KEY, password: DB_PASSWORD };
}

console.log("debug:", processValue("test"));
