import { createApp } from "./app";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

createApp().listen(port, host, () => {
  console.log(`Tambala Rendering API listening on ${host}:${port}`);
});
