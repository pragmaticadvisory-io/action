import * as core from "@actions/core";
import * as github from "@actions/github";
import { getOctokit } from "@actions/github";
import { createAppAuth } from "@octokit/auth-app";
import * as fs from "fs";
import { findResourcesChanges } from "./tfplan";

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"));
const prNum = ev.pull_request.number;

async function run() {
  try {
    const appId = parseInt(core.getInput("appId"));
    const privateKey = core.getInput("privateKey");
    const approversInput = core.getInput("approvers");
    const planPath = core.getInput("planPath");

    const token = await getInstallationToken({
      appId,
      privateKey,
    });
    const octokit = github.getOctokit(token);

    // parse TFplan file
    const changes = findResourcesChanges(planPath);

    console.log(`Relevant detected ${changes.length}`);
    for (const change of changes) {
      console.log(change.type, change.name, change.change.actions);
    }

    if (changes.length === 0) {
      core.info("No relevant changes found");
      return;
    }
    // get list of approvers for PR
    const approvers = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
      {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNum,
      }
    );
    // check if IAM team is in the list of approvers
    const approversTeam = approvers.data.teams.find(
      (team) => team.slug === approversInput
    );

    // request approval if necessary
    if (!approversTeam) {
      core.info(
        `Team "${approversInput}" is not in the list of approvers, requesting approval`
      );
      await octokit.request(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
        {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: prNum,
          team_reviewers: [approversInput],
        }
      );
    } else {
      core.info("Team is in the list of approvers, checking approval");
      const iamTeamMembers = await octokit.request(
        "GET /orgs/{org}/teams/{team_slug}/members",
        {
          org: github.context.repo.owner,
          team_slug: approversTeam.slug,
        }
      );

      const reviewers = iamTeamMembers.data.map((member) => member.login);

      const reviews = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: prNum,
        }
      );

      const approved = reviews.data.some(
        (review) =>
          review.state === "APPROVED" && reviewers.includes(review.user!.login)
      );

      if (approved) {
        core.info("Team approved the changes");
        return;
      }
    }

    core.setFailed(`Pending approval from team "${approversInput}"`);
  } catch (error: unknown) {
    core.setFailed(`Action failed with error ${error.message}`);
  }
}

run();

export async function getInstallationToken(props: {
  appId: number;
  privateKey: string;
}): Promise<string> {
  const { appId, privateKey } = props;

  try {
    const app = createAppAuth({
      appId,
      privateKey,
    });

    const authApp = await app({ type: "app" });
    const octokit = getOctokit(authApp.token);

    const installationId = await octokit.request(
      "GET /repos/{owner}/{repo}/installation",
      {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
      }
    );

    const {
      data: { token },
    } = await octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId.data.id,
        permissions: {},
        repositories: [github.context.repo.repo],
      }
    );
    return token;
  } catch (error: unknown) {
    console.log(error, JSON.stringify(error));
    throw new Error("Could not create installation access token.", {
      cause: error,
    });
  }
}
