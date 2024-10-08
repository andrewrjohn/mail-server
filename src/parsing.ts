export const parseHeader = (message: string) => {
  const lines = message.split("\n");

  let res = new Set<string>();

  for (const line of lines) {
    if (line.includes("Date")) {
      res.add(line);
    } else if (line.includes("From")) {
      res.add(line);
    } else if (line.includes("To")) {
      res.add(line);
    } else if (line.includes("Subject")) {
      res.add(line);
    } else if (line.includes("Content-Type")) {
      res.add(line);
    }
  }

  return Array.from(res).join("\n");
};
