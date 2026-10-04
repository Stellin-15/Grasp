/** Brief ideas for widely used reusable CI steps, keyed by reference without version. */
const KNOWN: Record<string, string> = {
  "actions/checkout": "Checks out the repository so later steps can use the code.",
  "actions/setup-node": "Installs a Node.js version, optionally with dependency caching.",
  "actions/setup-python": "Installs a Python version, optionally with pip caching.",
  "actions/setup-go": "Installs a Go version.",
  "actions/setup-java": "Installs a Java JDK and configures Maven or Gradle caching.",
  "actions/setup-dotnet": "Installs the .NET SDK.",
  "actions/cache": "Saves and restores directories (such as dependency caches) between runs.",
  "actions/upload-artifact":
    "Uploads files produced by the job so they can be downloaded or used by other jobs.",
  "actions/download-artifact": "Downloads files uploaded by an earlier job.",
  "actions/github-script":
    "Runs a small JavaScript snippet with an authenticated GitHub API client.",
  "actions/stale": "Labels and closes inactive issues and pull requests.",
  "actions/labeler": "Adds labels to pull requests based on changed paths.",
  "actions/configure-pages": "Prepares a GitHub Pages deployment.",
  "actions/upload-pages-artifact": "Packages a built site for GitHub Pages.",
  "actions/deploy-pages": "Publishes a built site to GitHub Pages.",
  "actions/dependency-review-action":
    "Fails a pull request that adds dependencies with known vulnerabilities.",
  "pnpm/action-setup": "Installs pnpm (version read from package.json packageManager by default).",
  "oven-sh/setup-bun": "Installs Bun.",
  "astral-sh/setup-uv": "Installs uv, the Python package manager.",
  "ruby/setup-ruby": "Installs Ruby and optionally runs bundle install with caching.",
  "dtolnay/rust-toolchain": "Installs a Rust toolchain.",
  "Swatinem/rust-cache": "Caches Rust build artifacts between runs.",
  "golangci/golangci-lint-action": "Runs golangci-lint, the Go linter aggregator.",
  "github/codeql-action/init": "Starts CodeQL security analysis for the chosen languages.",
  "github/codeql-action/analyze": "Finishes CodeQL analysis and uploads security findings.",
  "github/codeql-action/autobuild": "Builds compiled code so CodeQL can analyze it.",
  "codecov/codecov-action": "Uploads test coverage reports to Codecov.",
  "coverallsapp/github-action": "Uploads test coverage reports to Coveralls.",
  "changesets/action":
    "Opens a release pull request from changesets, and publishes packages when it is merged.",
  "softprops/action-gh-release": "Creates a GitHub Release, optionally with uploaded files.",
  "googleapis/release-please-action":
    "Maintains a release pull request with changelog and version bump from Conventional Commits.",
  "goreleaser/goreleaser-action": "Builds and publishes Go release binaries with GoReleaser.",
  "pypa/gh-action-pypi-publish": "Publishes Python distributions to PyPI.",
  "docker/setup-buildx-action": "Sets up Docker Buildx for advanced image builds.",
  "docker/setup-qemu-action": "Enables building Docker images for other CPU architectures.",
  "docker/login-action": "Logs in to a container registry.",
  "docker/build-push-action": "Builds a Docker image and optionally pushes it to a registry.",
  "docker/metadata-action": "Generates Docker image tags and labels from git refs.",
  "aws-actions/configure-aws-credentials": "Configures AWS credentials for later steps.",
  "google-github-actions/auth": "Authenticates to Google Cloud.",
  "azure/login": "Logs in to Azure.",
  "peaceiris/actions-gh-pages": "Pushes a built site to a GitHub Pages branch.",
  "JamesIves/github-pages-deploy-action": "Deploys a folder to a GitHub Pages branch.",
  "amondnet/vercel-action": "Deploys to Vercel.",
  "dependabot/fetch-metadata": "Reads metadata about a Dependabot pull request.",
  "pre-commit/action": "Runs the repository's pre-commit hooks.",
  // CircleCI orbs and Azure tasks
  "circleci/node": "CircleCI orb with Node.js install and caching commands.",
  "circleci/python": "CircleCI orb with Python install and caching commands.",
  NodeTool: "Azure task that installs a Node.js version.",
  UsePythonVersion: "Azure task that selects a Python version.",
  PublishTestResults: "Azure task that publishes test results to the run summary.",
  Docker: "Azure task that builds or pushes Docker images.",
};

/** `actions/checkout@v4` -> brief; also matches sub-paths like `github/codeql-action/init@v3`. */
export function describeUses(uses: string): string | undefined {
  const ref = uses.replace(/@.*$/, "").replace(/^docker:\/\//, "");
  if (ref.startsWith("./")) return "A local action defined in this repository.";
  if (KNOWN[ref]) return KNOWN[ref];
  const parts = ref.split("/");
  return parts.length > 2 ? KNOWN[parts.slice(0, 2).join("/")] : undefined;
}
