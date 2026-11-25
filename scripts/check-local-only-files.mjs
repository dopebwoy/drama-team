import { spawnSync } from 'node:child_process';

const protectedFiles = ['dev-secret.html', '.env'];
for (const file of protectedFiles) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { encoding: 'utf8' });
  if (result.status === 0) {
    console.error(`Build blocked: ${file} is tracked by Git and must remain local only.`);
    process.exitCode = 1;
  } else if (result.error) {
    console.error(`Build blocked: could not inspect Git tracking state (${result.error.message}).`);
    process.exitCode = 1;
  }

  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', file], { encoding: 'utf8' });
  if (ignored.status !== 0) {
    console.error(`Build blocked: ${file} must match a Git ignore rule.`);
    process.exitCode = 1;
  } else if (ignored.error) {
    console.error(`Build blocked: could not verify the Git ignore rule for ${file} (${ignored.error.message}).`);
    process.exitCode = 1;
  }
}
