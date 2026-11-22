import server from "./api/market-data.js";

const port = Number.parseInt(process.env.PORT || "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

server.listen(port, "0.0.0.0", () => {
  console.log(`UltraLOB listening on port ${port}`);
});
