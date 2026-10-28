const { hash } = require("..");

module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db) {
    await db.collection("users").insertOne({
      username: "admin",
      password: hash("admin"),
    });
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db) {
    await db.collection("users").deleteMany({});
    await db.collection("sessions").deleteMany({});
    await db.collection("timers").deleteMany({});
  },
};
