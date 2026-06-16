// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// A2A Agent Card endpoint — returns the agent's discovery metadata.
// Served as the external backend for the APIM-managed A2A API.

module.exports = async function (context, req) {
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers["host"] ||
    process.env.WEBSITE_HOSTNAME;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const baseUrl = `${protocol}://${host}`;

  const agentCard = {
    protocolVersion: "0.3.0",
    name: "KS A2A Weather Agent",
    description:
      "A2A weather agent backed by Open-Meteo, deployed as an Azure Function",
    url: baseUrl,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "get_weather",
        name: "Get weather",
        description:
          "Returns current weather conditions for a city using Open-Meteo",
        tags: ["weather", "demo"],
        examples: ["What is the weather in Seattle?", "weather in Paris"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  };

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: agentCard,
  };
};
