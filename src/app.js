const express = require('express');
const cookieParser = require("cookie-parser")

/**
 * - Routes required
 */
const authRouter = require("./routes/auth.routes")
const accountRouter = require("./routes/account.routes")
const transactionRoutes = require("./routes/transaction.routes")


const app = express();


/**
 * - Use Routes
 */

app.get("/", (req, res)=>{
    res.send("Ledger Service is up and running")
})
app.use(cookieParser())
app.use(express.json())

app.use("/api/auth", authRouter)
app.use("/api/accounts", accountRouter)
app.use("/api/transactions", transactionRoutes)



module.exports = app;