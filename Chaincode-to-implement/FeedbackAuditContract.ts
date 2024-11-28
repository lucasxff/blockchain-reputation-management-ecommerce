import {
  Context,
  Contract,
  Info,
  Transaction,
  Returns,
} from "fabric-contract-api";
import axios from "axios";
import { importSPKI, jwtVerify } from "jose";

interface FeedbackData {
  id: string;
  rater: string;
  subject: string;
  platform: string;
  timestamp: string;
  feedbackHash: string;
}

@Info({
  title: "FeedbackAuditContract",
  description: "Smart contract for submitting and auditing feedbacks",
})
export class FeedbackAuditContract extends Contract {
  @Transaction()
  public async submitFeedback(
    ctx: Context,
    id: string,
    rater: string,
    subject: string,
    platform: string,
    timestamp: string,
    feedbackHash: string
  ): Promise<FeedbackData> {
    const publicKey = await this.fetchPublicKey(rater);

    const feedback = await this.verifyAndExtractJWS(feedbackHash, publicKey);

    if (!id || !rater || !subject || !platform || !feedbackHash || !feedback) {
      throw new Error("Required fields are missing in the feedback.");
    }
    const feedbackKey = id + platform;

    const feedbackData: FeedbackData = {
      id: id,
      rater: rater,
      subject: subject,
      platform: platform,
      timestamp: timestamp,
      feedbackHash: feedbackHash,
    };
    await ctx.stub.putState(
      feedbackKey,
      Buffer.from(JSON.stringify(feedbackData))
    );

    console.log(`Feedback with ID ${id} saved in ledger.`);

    return feedbackData;
  }

  @Transaction(false)
  @Returns("FeedbackData")
  public async getFeedbackById(
    ctx: Context,
    id: string,
    platform: string
  ): Promise<FeedbackData> {
    const feedbackKey = id + platform;

    const feedbackAsBytes = await ctx.stub.getState(feedbackKey);
    if (!feedbackAsBytes || feedbackAsBytes.length === 0) {
      throw new Error(`Feedback with ID ${feedbackKey} not find.`);
    }

    const feedback = JSON.parse(feedbackAsBytes.toString());
    console.log(`Feedback found: ${JSON.stringify(feedback)}`);
    return feedback;
  }

  @Transaction(false)
  @Returns("string")
  public async getAllFeedbacks(ctx: Context): Promise<string> {
    const allResults = [];
    const iterator = await ctx.stub.getStateByRange("", "");

    let result = await iterator.next();
    while (!result.done) {
      const feedbackAsString = Buffer.from(
        result.value.value.toString()
      ).toString("utf8");
      let feedback;
      try {
        feedback = JSON.parse(feedbackAsString);
      } catch (error) {
        feedback = feedbackAsString;
      }
      allResults.push(feedback);
      result = await iterator.next();
    }

    return JSON.stringify(allResults);
  }

  private async fetchPublicKey(rater: string): Promise<string> {
    try {
      const response = await axios.get(
        `http://urchain.pt:3000/api/getPublicKey/${rater}`
      );
      return response.data.publicKey;
    } catch (error) {
      throw new Error(`error fetching public key: ${(error as Error).message}`);
    }
  }

  private async verifyAndExtractJWS(
    jwsFeedback: string,
    publicKey: string
  ): Promise<any> {
    try {
      const key = await importSPKI(publicKey, "RS256");
      const { payload } = await jwtVerify(jwsFeedback, key);
      console.log("Feedback extracted and verified:", payload);
      return payload;
    } catch (error) {
      throw new Error(`Error verifying JWS: ${(error as Error).message}`);
    }
  }
}
