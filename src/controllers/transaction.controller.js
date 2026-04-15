const mongoose = require("mongoose");
const transactionModel = require("../models/transaction.model");
const accountModel = require("../models/account.model");
const ledgerModel = require("../models/ledger.model");
const emailService = require("../services/email.service");

/**
 *- Create a new transaction
 * THE 10 STEP TRANSFER FLOW :
 * 1.Validate request
 * 2.Validate idempotency Key
 * 3.Check account status
 * 4.Derive sender balance from ledger
 * 5.Create transaction (PENDING)
 * 6.Create DEBIT ledger entry
 * 7.Create Credit ledger entry
 * 8.Mark transaction COMPLETED
 * 9.Commit MongoDB session
 * 10.Send email notification
 */

async function createTransaction(req, res) {
  /**
   * 1.Validate request
   */

  const { fromAccount, toAccount, amount, idempotencyKey } = req.body;

  if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "FromAccount, toAccount, Amount and idempotencyKey Required",
    });
  }

  const fromUserAccount = await accountModel.findOne({
    _id: fromAccount,
  });

  const toUserAccount = await accountModel.findOne({
    _id: toAccount,
  });

  if (!fromUserAccount || !toUserAccount) {
    return res.status(400).json({
      message: "Invalid fromAccount or toAccount",
    });
  }

  /**
   * 2.Validate idempotency Key
   */

  const isTransactionAlreadyExist = await transactionModel.findOne({
    idempotencyKey: idempotencyKey,
  });

  if (isTransactionAlreadyExist) {
    if (isTransactionAlreadyExist.status === "COMPLETED") {
      return res.status(200).json({
        message: "Transaction Already Processed",
        transaction: isTransactionAlreadyExist,
      });
    }
    if (isTransactionAlreadyExist.status === "PENDING") {
      return res.status(200).json({
        message: "Transaction is stil processing",
      });
    }
    if (isTransactionAlreadyExist.status === "FAILED") {
      return res.status(500).json({
        message: "Transaction processing failed, please retry",
      });
    }
    if (isTransactionAlreadyExist.status === "REVERSED") {
      return res.status(500).json({
        message: "Transaction was reversed, please retry",
      });
    }
  }

  /**
   * 3.Check account status
   */

  if (
    fromUserAccount.status !== "ACTIVE" ||
    toUserAccount.status !== "ACTIVE"
  ) {
    return res.status(400).json({
      message:
        "Both fromAccount and toAccount must be ACTIVE to process transaction",
    });
  }

  /**
   * 4.Derive sender balance from the ledger
   */

  const balance = await fromUserAccount.getBalance();

  if (balance < amount) {
    return res.status(400).json({
      message: `Insufficient balance. Current balance is ${balance}.Requested amount is ${amount}`,
    });
  }

  /**
   * 5. Create Transaction (PENDING)
   */
  let transaction;
  try {
    const session = await mongoose.startSession();
    session.startTransaction();

    transaction = (await transactionModel.create([
      {
        fromAccount,
        toAccount,
        amount,
        idempotencyKey,
        status: "PENDING",
      },
    ]))[0];

    const debitLedgerEntry = await ledgerModel.create(
      [
        {
          account: fromAccount,
          amount: amount,
          transaction: transaction._id,
          type: "DEBIT",
        },
      ],
      { session },
    );

    await (() => {
      return new Promise((resolve) => setTimeout(resolve, 15 * 1000));
    })();

    const creditLedgerEntry = await ledgerModel.create(
      [
        {
          account: toAccount,
          amount: amount,
          transaction: transaction._id,
          type: "CREDIT",
        },
      ],
      { session },
    );

    await transactionModel.findOneAndUpdate(
      { _id: transaction._id },
      { status: "COMPLETED" },
      { session },
    );

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    return res.status(400).json({
      message:
        error
    });
  }
  /**
   * 10. Send Email notification
   */

  await emailService.sendTransactionEmail(
    req.user.email,
    req.user.name,
    amount,
    toAccount._id,
  );

  return res.status(201).json({
    message: "Transaction completed successfully",
    transaction: transaction,
  });
}

async function createInitialFundsTransaction(req, res) {
  const { toAccount, amount, idempotencyKey } = req.body;

  if (!toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "toAccount, amount and idempotencyKey are required",
    });
  }

  const toUserAccount = await accountModel.findOne({
    _id: toAccount,
  });

  if (!toUserAccount) {
    return res.status(400).json({
      message: "Invalid toAccount",
    });
  }

  const fromUserAccount = await accountModel.findOne({
    user: req.user._id,
  });

  if (!fromUserAccount) {
    return res.status(400).json({
      message: "System User not found",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  const transaction = new transactionModel({
    fromAccount: fromUserAccount._id,
    toAccount,
    amount,
    idempotencyKey,
    status: "PENDING",
  });

  const debitLedgerEntry = await ledgerModel.create(
    [
      {
        account: fromUserAccount._id,
        amount: amount,
        transaction: transaction._id,
        type: "DEBIT",
      },
    ],
    { session },
  );

  const creditLedgerEntry = await ledgerModel.create(
    [
      {
        account: toAccount,
        amount: amount,
        transaction: transaction._id,
        type: "CREDIT",
      },
    ],
    { session },
  );

  transaction.status = "COMPLETED";
  await transaction.save({ session });

  await session.commitTransaction();
  session.endSession();

  return res.status(201).json({
    message: "Initial funds transaction completed successfully",
    transaction: transaction,
  });
}

module.exports = { createTransaction, createInitialFundsTransaction };
