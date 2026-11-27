# Makes a release: tags the head of main as vX.Y.Z and pushes the tag, which
# scripts/deploy.sh then installs on the server.
# Usage: scripts/release.ps1 0.2.0
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$tag = "v$Version"

function Stop-Release([string]$Reason) {
  Write-Host "No release: $Reason" -ForegroundColor Red
  exit 1
}

if ((git branch --show-current) -ne 'main') { Stop-Release 'switch to main first.' }
if (git status --porcelain) { Stop-Release 'there are uncommitted changes.' }
git fetch --quiet --tags origin
if ($LASTEXITCODE -ne 0) { Stop-Release 'cannot fetch from origin.' }
$head = git rev-parse HEAD
if ($head -ne (git rev-parse origin/main)) { Stop-Release 'main differs from origin/main: pull or push first.' }
if (git tag --list $tag) { Stop-Release "$tag already exists." }

$latest = git tag --list 'v[0-9]*' --sort=-version:refname | Select-Object -First 1
if ($latest -and ([version]$Version -le [version]$latest.Substring(1))) {
  Stop-Release "$tag is not after $latest, which the server would keep installing."
}

# CI must have passed on this commit. The repository's owner is the gh account to ask with.
if ((git remote get-url origin) -notmatch 'github\.com[:/]([^/]+)/([^/]+?)(\.git)?$') {
  Stop-Release 'origin is not a GitHub repository.'
}
$owner = $Matches[1]
$repository = "$owner/$($Matches[2])"
$token = gh auth token --user $owner
if ($LASTEXITCODE -ne 0) { Stop-Release "gh is not signed in as $owner." }
$previousToken = $env:GH_TOKEN
$env:GH_TOKEN = $token
try {
  $runs = gh run list --repo $repository --commit $head --workflow CI --limit 1 --json status,conclusion
  if ($LASTEXITCODE -ne 0) { Stop-Release 'cannot read the CI result.' }
} finally {
  $env:GH_TOKEN = $previousToken
}
$run = $runs | ConvertFrom-Json
if (-not $run) { Stop-Release 'CI has not run on this commit yet.' }
if ($run.status -ne 'completed') { Stop-Release 'CI is still running.' }
if ($run.conclusion -ne 'success') { Stop-Release "CI ended with $($run.conclusion)." }

git tag --annotate $tag --message "cash-scout $Version"
if ($LASTEXITCODE -ne 0) { Stop-Release 'cannot create the tag.' }
git push --quiet origin "refs/tags/$tag"
if ($LASTEXITCODE -ne 0) {
  git tag --delete $tag
  Stop-Release 'cannot push the tag.'
}
Write-Host "Released $tag. On the server: scripts/deploy.sh" -ForegroundColor Green
