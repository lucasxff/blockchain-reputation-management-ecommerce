const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const fs = require("fs");
const { CompactEncrypt, importSPKI, jwtVerify } = require("jose");

const fetch = require("node-fetch");
const app = express();
const port = 3000;

app.use(bodyParser.json());

const recordsFilePath = path.join(__dirname, "chains", "urChain.json");
const recordsPecFilePath = path.join(__dirname, "chains", "prChain.json");
const feedbacksFilePath = path.join(__dirname, "chains", "rdChain.json");

let urChain = [];
let prChain = [];
let rdChain = [];
let tempData = {};
let tempChallenges = {};
let activeConnections = {};

function loadRecords() {
  if (fs.existsSync(recordsFilePath)) {
    const data = fs.readFileSync(recordsFilePath, "utf-8");
    urChain = JSON.parse(data);
  }
  if (fs.existsSync(recordsPecFilePath)) {
    const data = fs.readFileSync(recordsPecFilePath, "utf-8");
    prChain = JSON.parse(data);
  }
}

function generateRandomChallenge() {
  return Math.random().toString(36).substring(2);
}

function addTempData(idHash, randomWord) {
  tempData[idHash] = {
    idHash,
    randomWord,
  };
}

function removeTempData(idHash) {
  if (tempData[idHash]) {
    delete tempData[idHash];
  }
}

function generateHashSHA256(json) {
  return crypto.createHash("sha256").update(json).digest("hex");
}

function readChain(caminho) {
  return JSON.parse(fs.readFileSync(caminho, "utf8"));
}

function saveRecord(path, chain) {
  fs.writeFileSync(path, JSON.stringify(chain, null, 2));
}

function loadFeedbacks() {
  if (fs.existsSync(feedbacksFilePath)) {
    const data = fs.readFileSync(feedbacksFilePath, "utf-8");
    rdChain = JSON.parse(data);
  }
}

loadFeedbacks();

loadRecords();

function generateRandomWord() {
  return Math.random().toString(36).substring(2, 8);
}

async function sendDataToWalletAndReceivePK(idHash, did) {
  const response = await fetch(
    `http://localhost:4000/wallet/register/${idHash}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ did }),
    }
  );
  if (!response.ok) {
    throw new Error("Error sending data to Wallet");
  }
  const data = await response.json();

  return data.publicKey;
}

function encryptWord(publicKey, word) {
  const buffer = Buffer.from(word, "utf-8");
  const encrypted = crypto.publicEncrypt(publicKey, buffer);
  return encrypted.toString("base64");
}

async function getPublicKey(idHash) {
  const response = await fetch(
    `http://localhost:4000/wallet/get-public-key/${idHash}`
  );

  if (!response.ok) {
    throw new Error("Error fetching Wallet public key.");
  }

  const data = await response.json();

  if (!data.publicKey) {
    throw new Error("Public key not found.");
  }

  return data.publicKey;
}

async function getDidPublicKey(did) {
  loadRecords();
  const ExistingRegistry = urChain.find(r => r.did === did);
  const publicKey = ExistingRegistry.publicKey;

  if (!publicKey) {
    throw new Error("Public key not found.");
  }
  return publicKey;
}

async function checkWalletExists(idHash) {
  const response = await fetch(`http://localhost:4000/wallet/exists/${idHash}`);
  const data = await response.json();
  return data.exists;
}

app.post("/api/get-feedback", (req, res) => {
  const { id, rater, platform } = req.body;

  loadFeedbacks();
  loadRecords();

  const feedbackKey = id + platform;

  const feedbackStored = rdChain.find(f => f.id === feedbackKey);

  if (!feedbackStored) {
    return res.status(404).json({ message: "feedbackStored not found." });
  }
  const registerRater = urChain.find(r => r.did === rater);

  if (!registerRater) {
    return res.status(404).json({ message: "registerRater record not found!" });
  }

  const publicKeyPEM = registerRater.publicKey;
  res.json({ feedbackStored, publicKeyPEM });
});

app.get("/api/getPublicKey/:rater", async (req, res) => {
  const { rater } = req.params;
  const publicKey = await getDidPublicKey(rater);

  if (!publicKey) {
    return res
      .status(404)
      .json({ message: "Publickey do raterDid não encontrado!" });
  }

  res.json({ publicKey: publicKey });
});

// REGISTER  ----------------------------------------------------------------------------

//URCHAIN
app.post("/api/register", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ message: "ID is required." });
  }

  const idHash = generateHashSHA256(id);

  const walletExiste = await checkWalletExists(idHash);

  if (!walletExiste) {
    return res.status(404).json({
      message: "Wallet for id does not exist. Record cannot be created.",
    });
  }

  let publicKey;
  try {
    publicKey = await getPublicKey(idHash);
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching public key from Wallet",
      error: error.message,
    });
  }

  const randomWord = generateRandomWord();

  const encryptedword = encryptWord(publicKey, randomWord);

  addTempData(idHash, randomWord);

  const walletUrl = `http://localhost:4000/wallet/${idHash}/generate-vc?encrypted_data=${encodeURIComponent(
    encryptedword
  )}`;

  res.status(200).json({
    message:
      "A Word has been encrypted with your public key, please decrypt it to generate a credential.",
    encryptedword,
    walletUrl,
  });
});

app.post("/api/confirm-registration", async (req, res) => {
  const { idHash, randomWord, store_url, user_id } = req.body;

  const tempRecord = tempData[idHash];

  if (!tempRecord) {
    return res.status(400).json({ message: "Temporary data not found." });
  }

  if (randomWord !== tempRecord.randomWord) {
    return res
      .status(400)
      .json({ message: "Incorrect Verifiable Credential." });
  }

  const did = uuidv4();
  const didrmb = `did:rmb:${did}`;

  let publicKey;
  try {
    publicKey = await sendDataToWalletAndReceivePK(idHash, didrmb);
  } catch (error) {
    return res.status(500).json({
      message: "Error sending data to Wallet and receiving PK",
      error: error.message,
    });
  }

  const newUrChain = {
    did: didrmb,
    idHash,
    publicKey,
    timestamp: new Date().toISOString(),
  };

  urChain.push(newUrChain);

  saveRecord(recordsFilePath, urChain);
  removeTempData(idHash);

  try {
    if (store_url && user_id) {
      const response = await fetch(
        `${store_url}/wp-json/blockchain-feedback/v1/update-did`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: user_id,
            did: didrmb,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Error updating DID in e-commerce.");
      }
    }

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      did: didrmb,
      publicKey,
      redirectTo: store_url
        ? `${store_url}/shop-2/my-account/edit-account/`
        : "/",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error updating DID in e-commerce..",
      error: error.message,
    });
  }
});

//PRCHAIN
app.post("/api/prchain/register", async (req, res) => {
  const { id, siteUrl } = req.body;

  if (!id || !siteUrl) {
    return res.status(400).json({ message: "id and siteUrl are required." });
  }

  const idHash = generateHashSHA256(id);

  const walletExiste = await checkWalletExists(idHash);
  if (!walletExiste) {
    return res.status(404).json({
      message: "Wallet for id does not exist. Record cannot be created.",
    });
  }

  const randomWord = generateRandomWord();

  let publicKey;
  try {
    publicKey = await getPublicKey(idHash);
  } catch (error) {
    return res.status(500).json({
      message: "Error fetching public key from Wallet",
      error: error.message,
    });
  }

  const encryptedword = encryptWord(publicKey, randomWord);

  addTempData(idHash, randomWord);

  const walletUrl = `http://localhost:4000/wallet/${idHash}/generate-vc?encrypted_data=${encodeURIComponent(
    encryptedword
  )}`;

  res.status(200).json({
    message:
      "A Word has been encrypted with your public key, please decrypt it to generate a credential.",
    encryptedword,
    walletUrl,
  });
});

app.post("/api/prchain/confirm-registration", async (req, res) => {
  const { idHash, randomWord, siteUrl } = req.body;

  const tempRecord = tempData[idHash];

  if (!tempRecord) {
    return res.status(400).json({ message: "Temporary data not found." });
  }

  if (randomWord !== tempRecord.randomWord) {
    return res
      .status(400)
      .json({ message: "Incorrect Verifiable Credential." });
  }

  const ecommercdid = uuidv4();
  const ecommercdidrmb = `did:rmb:${ecommercdid}`;

  let publicKey;
  try {
    publicKey = await updateEcommerceCredentials(siteUrl, ecommercdidrmb);
    if (response.status !== 200) {
      throw new Error(`Failed to update e-commerce: ${publicKey.statusText}`);
    }
  } catch (error) {}

  const newRecord = {
    prDid: ecommercdidrmb,
    idHash,
    publicKey,
    siteUrl,
    timestamp: new Date().toISOString(),
  };

  prChain.push(newRecord);
  saveRecord(recordsPecFilePath, prChain);

  removeTempData(idHash);

  res.status(201).json({
    message: "E-commerce successfully registered and updated",
    prDid: ecommercdidrmb,
    publicKey,
  });
});

async function updateEcommerceCredentials(siteUrl, ecommercdidrmb) {
  try {
    const response = await fetch(
      siteUrl + "/wp-json/blockchain-feedback/v1/update-ecommerce-credentials",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ did: ecommercdidrmb }),
      }
    );

    const data = await response.json();
    if (response.ok) {
      if (data.publicKey) {
        return data.publicKey;
      } else {
        console.error("Public key not returned:", data);
        return null;
      }
    } else {
      console.error("Response not OK:", data);
      return null;
    }
  } catch (error) {
    console.error("Error sending DID and private key to the store:", error);
    return null;
  }
}
//END -------------------------------------------------------------------------------------------------

//SUBMIT FEEDBACK ----------------------------------------------------------------------------------
app.post("/api/feedback", async (req, res) => {
  const { encrypted_feedback, did } = req.body;

  const ExistingSubject = prChain.find(s => s.prDid === did);
  if (!ExistingSubject) {
    return res.status(404).json({ message: "Platform DID record not found!" });
  }

  const publicKey = ExistingSubject.publicKey;

  const encryptedMessageBuffer = Buffer.from(encrypted_feedback, "base64");

  const decrypted = crypto.publicDecrypt(publicKey, encryptedMessageBuffer);

  const message = decrypted.toString("utf-8");

  const feedbackData = JSON.parse(message);

  const newFeedback = await findFeedbackByIdAndOrderId(
    feedbackData.id,
    feedbackData.order,
    ExistingSubject.siteUrl
  );

  if (!newFeedback) {
    return res.status(404).json({
      message: "Feedback not found for the given IDs.",
    });
  }

  const OriginalFeedback = newFeedback;

  const { id, platform, order, subject, rater, timestamp, feedback } =
    OriginalFeedback;

  if (
    !id ||
    typeof id !== "string" ||
    !rater ||
    typeof rater !== "string" ||
    !subject ||
    typeof subject !== "string" ||
    !order ||
    typeof order !== "string" ||
    !feedback ||
    typeof feedback !== "object"
  ) {
    return res.status(400).json({ message: "Invalid field types." });
  }

  const ExistingRegistry = urChain.find(r => r.did === rater);
  const prUrl = ExistingSubject.siteUrl;

  if (!ExistingRegistry) {
    return res.status(404).json({ message: "raterDid record not found!" });
  }

  const idHash = ExistingRegistry.idHash;

  try {
    const importedPublicKey = await importSPKI(
      ExistingRegistry.publicKey,
      "RSA-OAEP-256"
    );
    const jwt = await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify(OriginalFeedback))
    )
      .setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
      .encrypt(importedPublicKey);
    const walletResponse = await fetch(
      `http://localhost:4000/wallet/${idHash}/generate-link`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rater: rater,
          jwt: jwt,
          siteUrl: prUrl,
        }),
      }
    );

    if (!walletResponse.ok) {
      throw new Error("Error generating the link in the Wallet.");
    }

    const { link } = await walletResponse.json();

    res.status(200).json({
      message: "Feedback successfully received!",
      link,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error encrypting the feedback",
      error: error.message,
    });
  }
});

async function findFeedbackByIdAndOrderId(feedback_id, order_id, siteUrl) {
  const apiUrl = `${siteUrl}/wp-json/blockchain-feedback/v1/get-feedback-by-id`;

  try {
    const response = await fetch(
      `${apiUrl}?feedback_id=${feedback_id}&order_id=${order_id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching feedback: ${response.statusText}`);
    }

    const feedback = await response.json();
    return feedback;
  } catch (error) {
    console.error("Error fetching feedback from the plugin:", error);
    return null;
  }
}

function generateConnectionToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

app.post("/api/connect-wallet", async (req, res) => {
  const { idHash, raterDid } = req.body;

  const ExistingRegistry = urChain.find(
    r => r.idHash === idHash && r.did === raterDid
  );

  if (!ExistingRegistry) {
    return res.status(404).json({ message: "DID not found in the registry." });
  }

  const publicKey = ExistingRegistry.publicKey;

  if (!publicKey) {
    return res
      .status(500)
      .json({ message: "Public key not found for the DID." });
  }

  const challenge = generateRandomChallenge();

  let encryptedChallenge;
  try {
    const importedPublicKey = await importSPKI(publicKey, "RSA-OAEP-256");
    encryptedChallenge = await new TextEncoder().encode(challenge);
    encryptedChallenge = await new CompactEncrypt(encryptedChallenge)
      .setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
      .encrypt(importedPublicKey);
  } catch (error) {
    console.error("Error encrypting challenge:", error);
    return res.status(500).json({ message: "Error encrypting challenge" });
  }
  tempChallenges[idHash] = { challenge, raterDid };

  res.status(200).json({ challenge: encryptedChallenge });
});

app.post("/api/validate-wallet-response", (req, res) => {
  const { idHash, decryptedChallenge } = req.body;

  const challengeInfo = tempChallenges[idHash];
  if (!challengeInfo) {
    return res
      .status(404)
      .json({ message: "No challenge found for this connection." });
  }

  const { challenge, raterDid } = challengeInfo;

  if (decryptedChallenge !== challenge) {
    return res.status(400).json({ message: "Invalid challenge response." });
  }

  const connectionToken = generateConnectionToken();
  activeConnections[idHash] = { raterDid, connectionToken };

  delete tempChallenges[idHash];

  res.status(200).json({ connectionToken });
});

app.post("/api/add-to-ledger", async (req, res) => {
  const {
    id,
    rater,
    subject,
    platform,
    timestamp,
    jws,
    idHash,
    connectionToken,
  } = req.body;

  const activeConnection = activeConnections[idHash];
  if (
    !activeConnection ||
    activeConnection.connectionToken !== connectionToken
  ) {
    return res
      .status(401)
      .json({ message: "Unauthorized connection or expired token." });
  }

  //Here you need to connect with your 'gatewayConnection.js' on the Blockchain

  const ExistingRegistry = urChain.find(r => r.did === rater);
  if (!ExistingRegistry) {
    return res.status(404).json({ message: "raterDid record not found!" });
  }

  const publicKey = await importSPKI(ExistingRegistry.publicKey, "RS256");

  let feedback;
  try {
    const { payload } = await jwtVerify(jws, publicKey);
    feedback = payload;
  } catch (error) {
    return res.status(400).json({
      message: "Error verifying signed feedback",
      error: error.message,
    });
  }

  if (!id || !rater || !subject || !platform || !feedback) {
    return res
      .status(400)
      .json({ message: "Required fields are missing in the feedback." });
  }

  const feedbackKey = id + platform;
  try {
    const newRecord = {
      id: feedbackKey,
      rater: rater,
      subject: subject,
      platform: platform,
      timestamp: timestamp,
      feedbackHash: jws,
    };

    rdChain.push(newRecord);
    saveRecord(feedbacksFilePath, rdChain);

    delete activeConnections[idHash];

    res.json({
      success: true,
      message: "Feedback signed and confirmed successfully.",
      feedback: newRecord,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error recording feedback in ledger",
      error: error.message,
    });
  }
});

app.get("/api/get-idHash/:did", (req, res) => {
  const { did } = req.params;

  let ExistingRegistry = urChain.find(r => r.did === did);
  if (!ExistingRegistry) {
    ExistingRegistry = prChain.find(s => s.prDid === did);
  }

  if (!ExistingRegistry) {
    return res
      .status(404)
      .json({ message: "Record not found for the given DID." });
  }
  res.status(200).json({ idHash: ExistingRegistry.idHash });
});
//END ------------------------------------------------------------------------------------------------------

//GET OR CHECK FEEDBACK ----------------------------------------------------------------------------------
app.get("/api/feedbacks", (req, res) => {
  res.json(feedbacks);
});

app.post("/api/check-feedback", async (req, res) => {
  const feedbackJson = req.body;

  const {
    id,
    platform,
    order,
    subject,
    rater,
    feedback,
    "@context": context,
  } = feedbackJson;

  readChain(feedbacksFilePath);

  const feedbackKey = id + platform;

  const feedbackStored = rdChain.find(f => f.id === feedbackKey);

  if (!feedbackStored) {
    return res.status(404).json({ message: "Feedback not found." });
  }

  try {
    readChain(recordsFilePath);
    const existingRecord = urChain.find(r => r.did === rater);
    if (!existingRecord) {
      return res.status(404).json({ message: "Rater record not found." });
    }

    const publicKeyPEM = existingRecord.publicKey;
    const publicKey = await importSPKI(publicKeyPEM, "RS256");
    const { payload: payloadDecrypted } = await jwtVerify(
      feedbackStored.feedbackHash,
      publicKey
    );

    const currentFeedbackHash = generateHashSHA256(
      JSON.stringify(feedbackJson)
    );

    if (currentFeedbackHash === payloadDecrypted.feedbackHash) {
      return res.json({
        currentFeedbackHash: currentFeedbackHash,
        payloadDecrypted: payloadDecrypted.feedbackHash,
        message: "The feedback is intact and has not been altered.",
      });
    } else {
      return res.status(400).json({
        currentFeedbackHash: currentFeedbackHash,
        payloadDecrypted: payloadDecrypted.feedbackHash,
        message: "Feedback has been tampered with. Divergent hash.",
      });
    }
  } catch (error) {
    console.error("Error checking feedback:", error.message);
    return res
      .status(500)
      .json({ message: "Error checking feedback.", error: error.message });
  }
});
//END ------------------------------------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.get("/check-feedback", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "check-feedback.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
