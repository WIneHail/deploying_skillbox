require("dotenv").config();

const express = require("express");
const nunjucks = require("nunjucks");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { nanoid } = require("nanoid");
const crypto = require("crypto");

const app = express();

const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");

let cachedClient = global.MongoClient;

if (!cachedClient) {
  cachedClient = global.MongoClient = new MongoClient(process.env.DB_URI, {
    maxPoolSize: 10,
  });
}

const clientPromise = cachedClient.connect();

app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    req.db = client.db("users");
    next();
  } catch (error) {
    next(error);
  }
});

nunjucks.configure(path.join(__dirname, "views"), {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(express.json());
app.use(express.static("public"));

app.use(cookieParser());

const auth = () => async (req, res, next) => {
  if (!req.cookies["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);
  req.user = user;
  req.sessionId = req.cookies["sessionId"];
  next();
};

const hash = (d) => {
  return crypto.createHash("sha256").update(d.trim()).digest("hex");
};

const findUserByName = async (db, username) => await db.collection("users").findOne({ username });

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions").findOne(
    { sessionId },
    {
      projection: { userId: 1 },
    }
  );
  if (!session) {
    return;
  }
  return db.collection("users").findOne({ _id: new ObjectId(session.userId) });
};

const createSession = async (db, userId) => {
  const sessionId = nanoid();
  db.collection("sessions").insertOne({
    userId,
    sessionId,
  });
  return sessionId;
};

const delSession = async (db, sessionId) => {
  db.collection("sessions").deleteOne({ sessionId });
};

app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError:
      (req.query.authError === "authIssue" && "Wrong username or password") ||
      (req.query.authError === "singIssue" && "User already exists") ||
      (req.query.authError === "singInvalid" && "Invalid login or password"),
  });
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByName(req.db, username);
  console.log(user);
  if (user) {
    return res.status(409).redirect("/?authError=singIssue");
  }

  if (!username.trim() || !password.trim()) {
    return res.status(409).redirect("/?authError=singInvalid");
  }

  console.log(username, password);
  req.db.collection("users").insertOne({
    username: username,
    password: hash(password),
  });
  res.status(200).redirect("/");
});

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const user = await findUserByName(req.db, username);
  console.log(user, username, password);
  if (!user || user.password !== hash(password)) {
    return res.redirect("/?authError=authIssue");
  }

  const sessionId = await createSession(req.db, user._id);
  res.cookie("sessionId", sessionId, { httpOnly: true }).redirect("/");
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) res.redirect("/");
  console.log(req.sessionId);
  await delSession(req.db, req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

app.get("/api/timers", auth(), async (req, res) => {
  try {
    const isActive = req.query.isActive === "false" ? false : true;

    const timers = await req.db
      .collection("timers")
      .find({ isActive: isActive, userId: new ObjectId(req.user._id) })
      .toArray();

    res.json(
      timers.map((timer) => ({
        ...timer,
        start: +timer.start,
        progress: Date.now() - +timer.start,
      }))
    );
  } catch (error) {
    res.status(404).send(error.text);
  }
});

app.post("/api/timers", auth(), async (req, res) => {
  if (req.body) {
    req.db.collection("timers").insertOne({
      userId: new ObjectId(req.user._id),
      start: Date.now(),
      description: req.body.description,
      isActive: true,
    });
    res.status(200).send({ status: "ok" });
  } else {
    res.status(400).send({ status: "incorrect" });
  }
});

app.post("/api/timers/:id/stop", auth(), async (req, res) => {
  const id = req.params.id;
  const timer = await req.db
    .collection("timers")
    .findOne({ _id: new ObjectId(id), userId: new ObjectId(req.user._id) });
  if (!timer) return res.status(404).send({ status: "incorrect user" });
  req.db.collection("timers").findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        end: Date.now(),
        duration: Date.now() - Number(timer.start),
        isActive: false,
      },
    }
  );
  res.status(200).send({ status: "ok" });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});

module.exports = app;
