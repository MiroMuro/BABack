// server.test.js
const request = require("supertest");
const { createServer } = require("../server");
const resolvers = require("../resolver");
const User = require("../models/User");
const Book = require("../models/Book");
const Author = require("../models/Author");
const { MongoMemoryServer } = require("mongodb-memory-server");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
import { readFileSync } from "fs";
import { join } from "path";
import { gql } from "graphql-tag";
import { DocumentNode } from "graphql";
import * as http from "http";
import { testUser, ServerType } from "../types/interfaces";
import { books } from "./testdata";
//import exp from "constants";
dotenv.config();

let logintoken: string;

let mongoServer: typeof MongoMemoryServer;
let app: Express.Application;
let httpServer: http.Server;

const user: testUser = {
  username: "testUser1",
  password: "testPassword",
  favoriteGenre: "testGenre",
};

const typeDefs: DocumentNode = gql(
  readFileSync(join("src/", "schema.graphql"), "utf8")
);
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri: string = mongoServer.getUri();

  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  await User.deleteMany({});
  await Book.deleteMany({});
  await Author.deleteMany({});

  const serverSetup: ServerType = await createServer(typeDefs, resolvers);
  app = serverSetup.app;
  httpServer = serverSetup.httpServer;

  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  describe("Before tests", () => {});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  httpServer.close();
});

describe("Apollo Server", () => {
  it("should create a user", async () => {
    const mutation = `
      mutation {
        createUser(username: "${user.username}", password: "${user.password}", favoriteGenre: "${user.favoriteGenre}") {
          username
          favoriteGenre
          id
        }
      }
    `;

    const response = await request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send({ query: mutation });

    const { data } = response.body;

    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data.createUser).toBeDefined();
    expect(data.createUser.username).toBe(user.username);
    expect(data.createUser.favoriteGenre).toBe(user.favoriteGenre);
    expect(data.createUser.id).toBeDefined();
  });
  describe("Login", () => {
    it("is successful and returns an authorization token", async () => {
      const loginMutation = `
        mutation {
        login(username: "${user.username}", password: "${user.password}"){
          value
        }
      }
      `;

      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send({ query: loginMutation });

      const { data } = response.body;
      console.log("Data: ", data);
      expect(response.status).toBe(200);
      expect(data.login.value).toBeDefined();
      logintoken = data.login.value;
    });
    it("fails with wrong username", async () => {
      const badCredentialsLoginMutation = `
        mutation {
        login(username: "${"wrongUsername"}", password: "${user.password}"){
          value
        }
      }`;

      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send({ query: badCredentialsLoginMutation });

      const { data } = response.body;
      const [errors] = response.body.errors;

      expect(response.status).toBe(200);
      expect(data.login).toBeNull();
      expect(errors.message).toBe("Login failed!");
      expect(errors.extensions.code).toBe("WRONG_CREDENTIALS");
      expect(errors.extensions.invalidArgs).toBe("wrongUsername");
    });
    it("fails with wrong password", async () => {
      const badCredentialsLoginMutation = `
        mutation {
        login(username: "${user.username}", password: "${"wrongPassword"}"){
          value
        }
      }`;

      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send({ query: badCredentialsLoginMutation });

      const { data } = response.body;
      const [errors] = response.body.errors;

      expect(response.status).toBe(200);
      expect(data.login).toBeNull();
      expect(errors.message).toBe("Login failed!");
      expect(errors.extensions.code).toBe("WRONG_CREDENTIALS");
      expect(errors.extensions.invalidArgs).toBe("wrongPassword");
    });
  });
  describe("A book", () => {
    it("CANT be added by an unauthenticated user, and returns correct errors.", async () => {
      const book = books[0];
      const mutation = `
      mutation {
      addBook(title: "${book.title}", author: "${book.author}", published: ${
        book.published
      }, genres: ${JSON.stringify(book.genres)}){
        title
        author {
          name
          bookCount
        }
        published
        genres
      }
    }
      `;
      //Omit the authorization token, to simulate an unauthenticated user.
      //e.g an user that is not logged in.
      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send({ query: mutation });

      const { data } = response.body;
      const [errors] = response.body.errors;
      expect(response.status).toBe(200);
      expect(errors.message).toBe("User not authenticated.");
      expect(errors.extensions.code).toBe("UNAUTHENTICATED_USER");
      expect(errors.extensions.message).toBe("Authenticate yourself first.");
      expect(data.value).toBeUndefined();
    });
    it("Can be added by an authenticated user and Author bookcount is updated correctly", async () => {
      const book = books[0];
      const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${book.author}", published: ${
        book.published
      }, genres: ${JSON.stringify(book.genres)}){
          title
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;

      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .set("Authorization", `bearer ${logintoken}`)
        .send({ query: mutation });

      const { data } = response.body;

      expect(response.status).toBe(200);
      expect(data).toBeDefined();
      expect(data.addBook).toBeDefined();
      expect(data.addBook.title).toBe(book.title);
      expect(data.addBook.author).toStrictEqual({
        name: book.author,
        bookCount: 1,
      });
      expect(data.addBook.published).toBe(book.published);
      expect(data.addBook.genres).toEqual(book.genres);
    });
    it("Can be fetched correctly", async () => {
      //The added book should be the first book in the array.
      //It needs to be added a bookcount property to the author object.
      const addedBook = {
        ...books[0],
        author: { name: books[0].author, bookCount: 1 },
      };
      console.log("Added book: ", addedBook);
      const query = `
        query {
          allBooks{
            title
            author {
              name
              bookCount
            }
            genres
            published
            title
        }
      }`;

      const response = await request(app).post("/").send({ query });
      const { data } = response.body;
      expect(response.status).toBe(200);
      expect(data).toBeDefined();
      expect(data.allBooks).toBeDefined();
      expect(data.allBooks[0]).toEqual(addedBook);
      console.log(data.allBooks);
      //console.log(query);
    });
    describe("Cant be added with", () => {
      it("duplicate title and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${book.author}", published: ${
          book.published
        }, genres: ${JSON.stringify(book.genres)}){
          title
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;

        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        expect(response.status).toBe(200);
        expect(data.value).toBeUndefined();
        expect(errors.message).toBe("Creating a book failed!");
        expect(errors.extensions.code).toBe("DUPLICATE_BOOK_TITLE");
        expect(errors.extensions.error._message).toBe(
          "BookMongo validation failed"
        );
        expect(errors.extensions.error.name).toBe("ValidationError");
        expect(errors.extensions.error.message).toBe(
          "BookMongo validation failed: title: Error, expected `title` to be unique. Value: `Oddly Normal`"
        );
        console.log("Data: ", data);
        console.log("Errors: ", errors);
      });
      it("empty title and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${""}", author: "${book.author}", published: ${
          book.published
        }, genres: ${JSON.stringify(book.genres)}){
          title
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;

        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        expect(response.status).toBe(200);
        expect(data.value).toBeUndefined();
        expect(errors.message).toBe("Creating a book failed!");
        expect(errors.extensions.message).toBe("Book title too short!");
        expect(errors.extensions.code).toBe("BAD_BOOK_TITLE");
      });
      it("empty author and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${""}", published: ${
          book.published
        }, genres: ${JSON.stringify(book.genres)}){
          title
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;
        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        expect(response.status).toBe(200);
        expect(data.value).toBeUndefined();
        expect(errors.message).toBe("Creating a book failed!");
        expect(errors.extensions.message).toBe("Author name too short!");
        expect(errors.extensions.code).toBe("BAD_AUTHOR_NAME");
      });
      it("empty published and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${
          book.author
        }", published: ${undefined}, genres: ${JSON.stringify(book.genres)}){
          title 
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;
        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        expect(response.status).toBe(400);
        expect(data).toBeUndefined();
        expect(errors.message).toBe(
          "Int cannot represent non-integer value: undefined"
        );
        expect(errors.extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
        //expect(errors.extensions.code).toBe("BAD_BOOK_PUBLICATION_DATE");
      });
      it("negative publication year and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${
          book.author
        }", published: ${-2000}, genres: ${JSON.stringify(book.genres)}){
          title 
          author {
            name
            bookCount
          }
          published
          genres
        }
      }
        `;
        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        // console.log("Response: ", data);
        //c onsole.log("Errors: ", errors);
        expect(response.status).toBe(200);
        expect(data.value).toBeUndefined();
        expect(errors.message).toBe("Creating a book failed!");
        expect(errors.extensions.message).toBe(
          "Publication date cant be negative!"
        );
        expect(errors.extensions.code).toBe("BAD_BOOK_PUBLICATION_DATE");
      });
      it("empty genres and returns corresponsing errors", async () => {
        const book = books[0];
        const mutation = `
        mutation {
        addBook(title: "${book.title}", author: "${book.author}",published: ${
          book.published
        }, genres: ${JSON.stringify([])}){
        title
        author{
          name
          bookCount
        }
        published
        genres
        }
      }
        `;
        const response = await request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("Authorization", `bearer ${logintoken}`)
          .send({ query: mutation });

        const { data } = response.body;
        const [errors] = response.body.errors;
        expect(response.status).toBe(200);
        expect(data.value).toBeUndefined();
        expect(errors.message).toBe("Creating a book failed!");
        expect(errors.extensions.message).toBe(
          "Book must have at least one genre!"
        );
        expect(errors.extensions.code).toBe("BAD_BOOK_GENRES");
      });
    });

    it("should respond to a simple query", async () => {
      const query = `
      query {
        allGenres
      }
    `;
      const response = await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send({ query });

      const { data } = response.body;

      expect(response.status).toBe(200);
      expect(data).toBeDefined();
      expect(data.allGenres).toBeDefined();
    });
  });
  describe("Amount of books ", () => {
    it("is updated correctly ", async () => {
      const secondBook = books[1];
      const thirdBook = books[2];
      const secondMutation = `
        mutation {
        addBook(title: "${secondBook.title}", author: "${
        secondBook.author
      }",published: ${secondBook.published}, genres: ${JSON.stringify(
        secondBook.genres
      )}){
        title
        author{
          name
          bookCount
        }
        published
        genres
        }
      }
        `;
      const thirdMutation = `
        mutation {
        addBook(title: "${thirdBook.title}", author: "${
        thirdBook.author
      }",published: ${thirdBook.published}, genres: ${JSON.stringify(
        thirdBook.genres
      )}){
      title
      author{
        name
        bookCount
      }
      published
      genres
      }
    }
        `;
      const bookCountQuery = `query{ bookCount}`;

      //Add two more books
      await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .set("Authorization", `bearer ${logintoken}`)
        .send({ query: secondMutation });
      await request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .set("Authorization", `bearer ${logintoken}`)
        .send({ query: thirdMutation });

      const response = await request(app)
        .post("/")
        .send({ query: bookCountQuery });

      const { data } = response.body;
      expect(response.status).toBe(200);
      expect(data).toBeDefined();
      expect(data.bookCount).toBe(3);
    });
  });
});
export {};
