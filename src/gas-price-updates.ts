import axios from 'axios';

interface Commit {
  sha: string;
  node_id: string;
}

interface File {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch: string;
}

interface CommitDetails {
  sha: string;
  files: File[];
}

interface GasPrices {
  [chain: string]: {
    low: number;
    average: number;
    high: number;
  };
}

interface UpdatedChain {
  chainName: string;
  commitSha: string;
}

const gasPriceRegex = /(fixed_min_gas_price|low_gas_price|average_gas_price|high_gas_price)/;

const baseUrl = 'https://github.com/cosmos/chain-registry/commit'

async function getCommitsSinceLastPoll(): Promise<Commit[]> {
  // Calculate since and until parameters
  const currentDateTime = new Date();
  const sinceTime = new Date(currentDateTime.getTime() - 6 * 60 * 60 * 1000);
  const sinceParam = sinceTime.toISOString();
  const untilParam = currentDateTime.toISOString();

  // Make API request to get commits
  const apiURL = `https://api.github.com/repos/cosmos/chain-registry/commits?since=${sinceParam}&until=${untilParam}`;
  const response = await axios.get(apiURL);
  return response.data;
}

async function getCommitDetails(sha: string): Promise<CommitDetails> {
  // Make API request to get details for a specific commit
  const apiURL = `https://api.github.com/repos/cosmos/chain-registry/commits/${sha}`;
  const response = await axios.get(apiURL);
  return response.data;
}

async function getGasPricesForSupportedChains(): Promise<GasPrices> {
  // Make API request to get gas prices
  const gasURL = 'https://assets.leapwallet.io/cosmos-registry/v1/gas/gas-prices.json';
  const response = await axios.get(gasURL);
  return response.data;
}

async function processCommit(commit: Commit, updatedChains: UpdatedChain[]): Promise<void> {
  const sha = commit.sha;

  const commitDetails = await getCommitDetails(sha);

  // Extract relevant information from the commit details
  const files = commitDetails.files || [];

  files.forEach((file) => {
    const filename = file.filename.toLowerCase();
    const path = filename.split('/');
    if (path[1] !== 'chain.json') return;
    const changes = file.patch;
    if (gasPriceRegex.test(changes)) {
      updatedChains.push({
        chainName: path[0],
        commitSha: sha,
      });
    };

  });
}

async function sendSlackMessage(message: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  const headers = {
    'Content-Type': 'application/json',
    // Add any other headers as needed
  };
  const slackURLPrefix = 'https://hooks.slack.com/services';
  const slackURLSuffix = '/T03BQ7YT8H3/B06BT6HFTK5/CQ4Gn5QwtdzXq7aharmEWadW' // gas price update alert channel
  const apiUrl = slackURLPrefix + slackURLSuffix;
  const body = JSON.stringify({
    text: message,
  });
  try {
    await axios.post(apiUrl, body, {
      headers: headers,
      signal: controller.signal,
    });
  } catch (err) {
    console.log('Error sending slack message: ', err);
    clearTimeout(timeoutId);
  }
  clearTimeout(timeoutId);
}

async function main() {

  try {
    // Step 1: Get commits since the last poll
    const commits = await getCommitsSinceLastPoll();

    // Step 2: Get gas prices
    // const supportedChains = await getGasPricesForSupportedChains();

    const updatedChains: UpdatedChain[] = [];
    const promises = [];
    console.log('Number of commits: ', commits.length);
    // Step 3: Process each commit
    for (const commit of commits) {
      promises.push(processCommit(commit, updatedChains));
    }
    await Promise.all(promises);

    console.log('Updated chains: ', updatedChains);

    if (updatedChains.length > 0) {
      const message = `:information_source: Changes have been made for the following chains:\n${updatedChains.map(chain => `• <${baseUrl}${chain.commitSha}|${chain.chainName}>`).join('\n')}`;
      await sendSlackMessage(message);
    }
  } catch (err) {
    const message = `:warning: Error occurred while processing commits: ${err}`;
    await sendSlackMessage(message);
  }
}
main();
