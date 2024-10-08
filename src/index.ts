//const typeDefs = require("./schema");
const resolvers = require("./resolver");
import * as http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { gql } from "graphql-tag";
import { DocumentNode } from "graphql";
require("dotenv").config();
const {
  createServer,
  InitializeMongoDB,
  initializeTestMongoServer,
} = require("./server");
import { ServerType } from "./types/interfaces";
import { MongooseError } from "mongoose";

const startApplication = async () => {
  console.log("Starting the application in Mode: ", process.env.NODE_ENV);
  try {
    //Read the schema
    const typeDefs: DocumentNode = gql(
      readFileSync(join(__dirname, "schema.graphql"), "utf8")
    );
    //Initialize the MongoDB connection.
    // Mock the MongoDB connection and DB for testing.
    if (process.env.NODE_ENV === "test") {
      await initializeTestMongoServer();
    } else {
      await InitializeMongoDB();
    }
    //Create the http and websocket servers.
    const serverSetup: ServerType = await createServer(typeDefs, resolvers);
    const httpServer: http.Server = serverSetup.httpServer;

    //Start the server.
    const PORT = process.env.PORT || 4000;
    httpServer.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error: unknown) {
    if (error instanceof MongooseError) {
      console.log("Error connecting to MongoDB: ", error.message);
    } else if (error instanceof Error) {
      console.log("Error starting the application: ", error.message);
    }
  }
};

startApplication();
