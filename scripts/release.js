#!/usr/bin/env node

/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Release Script
 * ==============
 * This script automates the release process for Obsidian plugins by:
 * - Incrementing version numbers in manifest.json, package.json, and versions.json
 * - Creating a release branch and pull request with the version bump
 * - Publishing a merged release by creating and pushing a git tag
 *
 * Usage:
 *   node release.js                    # Publish an untagged merged version, or choose the next release
 *   node release.js patch              # Prepare a patch release PR
 *   node release.js minor              # Prepare a minor release PR
 *   node release.js major              # Prepare a major release PR
 *   node release.js patch --dry-run    # Preview changes without executing
 *
 * Version numbering follows Semantic Versioning (semver):
 *   MAJOR.MINOR.PATCH (e.g., 1.2.3)
 *
 *   - PATCH (x.x.X): Bug fixes, small tweaks, documentation updates
 *     Example: 1.2.3 → 1.2.4
 *     Use when: You fixed a bug, updated docs, or made tiny improvements
 *
 *   - MINOR (x.X.x): New features, backwards-compatible changes
 *     Example: 1.2.3 → 1.3.0 (patch resets to 0)
 *     Use when: You added new commands, settings, or features that don't break existing functionality
 *
 *   - MAJOR (X.x.x): Breaking changes, major rewrites, incompatible API changes
 *     Example: 1.2.3 → 2.0.0 (minor and patch reset to 0)
 *     Use when: You changed how settings work, removed features, or made changes that require users to reconfigure
 *
 * Make sure you have committed all your changes before running this script.
 * Release version changes must go through a pull request before publishing.
 */

const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const os = require('os');

// ============================================================================
// CONFIGURATION
// ============================================================================

const projectRoot = path.join(__dirname, '..');
const validReleaseTypes = ['patch', 'minor', 'major'];
const lockFilePath = path.join(projectRoot, '.release.lock');

// ============================================================================
// GLOBAL STATE
// ============================================================================

let needsCleanup = false;
let isDryRun = false;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Helper function to safely parse JSON files
function parseJsonFile(filePath, filename) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse ${filename}: ${error.message}`);
    }
}

// Helper function to write JSON files with consistent formatting
function writeJsonFile(filePath, data) {
    if (isDryRun) {
        console.log(`[DRY RUN] Would write to ${path.basename(filePath)}`);
        return;
    }
    // Write to temp file first for atomic operation
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tempPath, filePath);
}

function isDryRunGitMutation(args) {
    const command = args[0];
    if (['add', 'commit', 'push', 'checkout'].includes(command)) {
        return true;
    }
    if (command === 'tag') {
        return args.some(arg => ['-a', '--annotate', '-s', '--sign', '-d', '--delete', '-f', '--force'].includes(arg));
    }
    if (command === 'branch') {
        return args.some(arg => ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy'].includes(arg));
    }
    return false;
}

function getDryRunGitResult(options) {
    return options.encoding ? '' : Buffer.from('');
}

function logDryRunCommand(command) {
    console.log(`[DRY RUN] Would run: ${command}`);
}

// Helper to execute git commands with array syntax (safe from injection)
function gitExecArray(args, options = {}) {
    if (isDryRun && isDryRunGitMutation(args)) {
        logDryRunCommand(`git ${args.join(' ')}`);
        return getDryRunGitResult(options);
    }
    return execFileSync('git', args, { cwd: projectRoot, ...options });
}

// Helper to execute git commands that return strings
function gitExecString(args, options = {}) {
    const result = gitExecArray(args, { encoding: 'utf8', ...options }).trim();
    return result;
}

function commandAvailable(command) {
    try {
        execFileSync(command, ['--version'], { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function assertOnlyExpectedChanges(expectedFiles) {
    const expectedFileSet = new Set(expectedFiles);
    const status = gitExecArray(['status', '--porcelain'], { encoding: 'utf8' }).trimEnd();

    if (!status) {
        return;
    }

    const unexpectedChanges = status.split('\n').filter(line => {
        const pathPart = line.slice(3);
        const changedPath = pathPart.includes(' -> ') ? pathPart.split(' -> ').pop() : pathPart;
        return !expectedFileSet.has(changedPath);
    });

    if (unexpectedChanges.length === 0) {
        return;
    }

    throw new Error(
        [
            'Build changed files outside the release metadata:',
            ...unexpectedChanges.map(line => `   ${line}`),
            '',
            'Commit or fix these generated changes before preparing the release.'
        ].join('\n')
    );
}

function updatePackageLockVersion(packageLock, newVersion) {
    if (!packageLock || typeof packageLock !== 'object') {
        throw new Error('package-lock.json is not a valid object');
    }

    if ('version' in packageLock) {
        packageLock.version = newVersion;
    }

    const rootPackage = packageLock.packages?.[''];
    if (rootPackage && typeof rootPackage === 'object') {
        rootPackage.version = newVersion;
    }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

function checkGitAvailable() {
    try {
        if (os.platform() === 'win32') {
            execSync('git --version', { stdio: 'ignore', shell: true });
        } else {
            execSync('git --version', { stdio: 'ignore' });
        }
    } catch (e) {
        console.error('❌ git is not installed or not in PATH');
        console.error('   Please install git first');
        process.exit(1);
    }
}

function checkNpmAvailable() {
    try {
        if (os.platform() === 'win32') {
            execSync('npm --version', { stdio: 'ignore', shell: true });
        } else {
            execSync('npm --version', { stdio: 'ignore' });
        }
    } catch (e) {
        console.error('❌ npm is not installed or not in PATH');
        console.error('   Please install Node.js and npm first');
        process.exit(1);
    }
}

function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        console.error('❌ manifest.json is not a valid object');
        process.exit(1);
    }

    if (!manifest.version) {
        console.error('❌ manifest.json is missing required field: version');
        process.exit(1);
    }

    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        console.error(`❌ Invalid version format in manifest.json: ${manifest.version}`);
        console.error('   Version must be in format: MAJOR.MINOR.PATCH (e.g., 1.2.3)');
        process.exit(1);
    }

    if (!manifest.minAppVersion || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) {
        console.error('❌ manifest.json has invalid or missing minAppVersion');
        console.error('   minAppVersion must be in format: MAJOR.MINOR.PATCH (e.g., 0.15.0)');
        process.exit(1);
    }
}

function validateVersionNumbers(versionParts) {
    if (versionParts.some(isNaN) || versionParts.some(n => n < 0 || n > 9999)) {
        console.error('❌ Invalid version numbers (must be 0-9999)');
        process.exit(1);
    }
}

function checkVersionOverflow(major, minor, patch, releaseType) {
    if (releaseType === 'patch' && patch >= 9999) {
        console.error('❌ Patch version would overflow (max 9999)');
        console.error('   Consider a minor or major release instead');
        process.exit(1);
    }
    if (releaseType === 'minor' && minor >= 9999) {
        console.error('❌ Minor version would overflow (max 9999)');
        console.error('   Consider a major release instead');
        process.exit(1);
    }
    if (releaseType === 'major' && major >= 9999) {
        console.error('❌ Major version would overflow (max 9999)');
        console.error('   This project has reached maximum version!');
        process.exit(1);
    }
}

// ============================================================================
// GIT OPERATIONS
// ============================================================================

function preReleaseChecks() {
    try {
        // Check if we're in a git repository
        try {
            gitExecArray(['rev-parse', '--git-dir'], { stdio: 'pipe' });
        } catch (e) {
            console.error('❌ Not in a git repository');
            console.error('   Initialize a git repository first with: git init');
            process.exit(1);
        }

        // Check for uncommitted changes FIRST
        const status = gitExecString(['status', '--porcelain']);
        if (status) {
            console.error('❌ You have uncommitted changes:');
            console.error(
                status
                    .split('\n')
                    .map(line => '   ' + line)
                    .join('\n')
            );
            console.error('\n   Please commit or stash all changes before releasing.');
            console.error('   Run: git status');
            process.exit(1);
        }

        // Check current branch
        const currentBranch = gitExecString(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (currentBranch !== 'main') {
            console.error(`❌ You must be on the 'main' branch to create a release.`);
            console.error(`   Current branch: ${currentBranch}`);
            console.error(`   Run: git checkout main`);
            process.exit(1);
        }

        // Check if remote exists
        try {
            gitExecArray(['remote', 'get-url', 'origin'], { stdio: 'pipe' });
        } catch (e) {
            console.error('❌ No remote named "origin" found');
            console.error('   Add a remote with: git remote add origin <url>');
            process.exit(1);
        }

        // Check if branch is up to date with remote
        try {
            if (isDryRun) {
                logDryRunCommand('git fetch');
            } else {
                gitExecArray(['fetch'], { stdio: 'pipe' });
            }
        } catch (e) {
            console.error('❌ Failed to fetch from remote:', e.message);
            process.exit(1);
        }

        const localCommit = gitExecString(['rev-parse', 'HEAD']);
        let remoteCommit;
        try {
            remoteCommit = gitExecString(['rev-parse', 'origin/main']);
        } catch (e) {
            console.error('❌ Cannot find remote branch origin/main');
            console.error('   Make sure you have pushed the main branch at least once');
            process.exit(1);
        }

        if (localCommit !== remoteCommit) {
            console.error('❌ Your local branch is not in sync with origin/main');
            console.error('   Run: git pull origin main');
            process.exit(1);
        }

        console.log('✓ Git repository is clean and ready');
        console.log('✓ On main branch and in sync with remote');
    } catch (error) {
        console.error('❌ Pre-release checks failed:', error.message);
        process.exit(1);
    }
}

function syncMainForDefaultFlow(selectedReleaseType, dryRun) {
    if (selectedReleaseType || dryRun) {
        return;
    }

    let currentBranch;
    try {
        currentBranch = gitExecString(['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch (e) {
        return;
    }

    if (currentBranch !== 'main') {
        return;
    }

    try {
        gitExecArray(['fetch', 'origin', 'main'], { stdio: 'pipe' });

        const localCommit = gitExecString(['rev-parse', 'main']);
        const remoteCommit = gitExecString(['rev-parse', 'origin/main']);
        if (localCommit === remoteCommit) {
            return;
        }

        const status = gitExecString(['status', '--porcelain']);
        if (status) {
            console.error('❌ Local main is behind origin/main, but the worktree has uncommitted changes.');
            console.error('   Commit or stash the changes, then run: node scripts/release.js');
            process.exit(1);
        }

        const mergeBase = gitExecString(['merge-base', 'main', 'origin/main']);
        if (mergeBase !== localCommit) {
            console.error('❌ Local main cannot be fast-forwarded from origin/main.');
            console.error('   Resolve the branch state manually, then run: node scripts/release.js');
            process.exit(1);
        }

        gitExecArray(['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });
        console.log('✓ Updated local main from origin/main');
    } catch (error) {
        console.error('❌ Failed to update local main:', error.message);
        process.exit(1);
    }
}

function getTagStatus(version) {
    const localTags = gitExecString(['tag', '-l', version]);
    const localTagExists = Boolean(localTags);

    try {
        if (isDryRun) {
            logDryRunCommand('git fetch --tags');
        } else {
            gitExecArray(['fetch', '--tags'], { stdio: 'pipe' });
        }
    } catch (e) {
        console.error('⚠️  Warning: Could not fetch tags:', e.message);
    }

    const remoteTags = gitExecString(['ls-remote', '--tags', 'origin']);
    const remoteTagExists = remoteTags.split('\n').some(line => {
        const ref = line.trim().split(/\s+/)[1];
        return ref === `refs/tags/${version}` || ref === `refs/tags/${version}^{}`;
    });

    return { localTagExists, remoteTagExists };
}

function checkExistingTag(version) {
    try {
        const { localTagExists, remoteTagExists } = getTagStatus(version);

        if (localTagExists) {
            console.error(`❌ Tag ${version} already exists locally`);
            process.exit(1);
        }

        if (remoteTagExists) {
            console.error(`❌ Tag ${version} already exists on remote`);
            console.error('   This version has already been released');
            process.exit(1);
        }

        console.log(`✓ Tag ${version} is available`);
    } catch (error) {
        console.error('❌ Failed to check existing tags:', error.message);
        process.exit(1);
    }
}

function checkReleaseBranchAvailable(version) {
    const branchName = `release/${version}`;

    try {
        gitExecArray(['rev-parse', '--verify', branchName], { stdio: 'pipe' });
        console.error(`❌ Local branch ${branchName} already exists`);
        console.error(`   Delete it or choose a different version before retrying.`);
        process.exit(1);
    } catch (e) {
        // Missing local branch is expected.
    }

    try {
        const remoteBranch = gitExecString(['ls-remote', '--heads', 'origin', branchName]);
        if (remoteBranch) {
            console.error(`❌ Remote branch ${branchName} already exists`);
            console.error(`   Close or remove the existing release branch before retrying.`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Failed to check existing release branches:', error.message);
        process.exit(1);
    }

    console.log(`✓ Release branch ${branchName} is available`);
    return branchName;
}

// ============================================================================
// BUILD OPERATIONS
// ============================================================================

function verifyBuild() {
    console.log('\n🔨 Running full build verification...');

    try {
        // Check if package.json exists
        const packageJsonPath = path.join(projectRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            console.error('❌ No package.json found');
            console.error('   Cannot run build without package.json');
            process.exit(1);
        }

        const buildScriptPath = path.join(projectRoot, 'scripts', 'build.sh');
        if (!fs.existsSync(buildScriptPath)) {
            console.error('❌ Build script not found');
            console.error('   Expected: scripts/build.sh');
            process.exit(1);
        }

        // Check if package build script exists because scripts/build.sh calls it
        const packageJson = parseJsonFile(packageJsonPath, 'package.json');
        if (!packageJson.scripts || !packageJson.scripts.build) {
            console.error('❌ No build script found in package.json');
            console.error('   Add a "build" script to package.json');
            process.exit(1);
        }

        // Check if npm is available
        checkNpmAvailable();

        if (isDryRun) {
            logDryRunCommand(os.platform() === 'win32' ? 'bash scripts/build.sh' : './scripts/build.sh');
            console.log('✓ Full build command is available\n');
            return;
        }

        // Run the full build gate used by CI.
        if (os.platform() === 'win32') {
            if (!commandAvailable('bash')) {
                console.error('❌ bash is required to run scripts/build.sh on Windows');
                console.error('   Install Git Bash or run release verification from a Unix-like shell');
                process.exit(1);
            }
            execFileSync('bash', [buildScriptPath], { stdio: 'inherit', cwd: projectRoot });
        } else {
            execFileSync(buildScriptPath, [], { stdio: 'inherit', cwd: projectRoot });
        }

        // Verify build output exists
        const expectedFiles = ['main.js', 'manifest.json', 'styles.css'];
        const missingFiles = expectedFiles.filter(file => !fs.existsSync(path.join(projectRoot, file)));

        if (missingFiles.length > 0) {
            console.error('❌ Build failed - missing expected files:', missingFiles.join(', '));
            process.exit(1);
        }

        console.log('✓ Full build completed successfully\n');
    } catch (error) {
        console.error('❌ Full build failed:', error.message);
        console.error('   Fix build errors before releasing');
        process.exit(1);
    }
}

// ============================================================================
// PRE-FLIGHT VALIDATIONS
// ============================================================================

function validateReleaseReadiness(manifest, currentVersion) {
    console.log('🔍 Validating release readiness...\n');

    // Check package.json version matches manifest.json
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = parseJsonFile(packageJsonPath, 'package.json');
        if (packageJson.version !== currentVersion) {
            console.error('❌ Version mismatch between manifest.json and package.json');
            console.error(`   manifest.json: ${currentVersion}`);
            console.error(`   package.json:  ${packageJson.version}`);
            console.error('   Align versions before releasing');
            process.exit(1);
        }
        console.log('✓ package.json version matches manifest.json');
    }

    // Check package-lock.json version matches manifest.json
    const packageLockPath = path.join(projectRoot, 'package-lock.json');
    if (fs.existsSync(packageLockPath)) {
        const packageLock = parseJsonFile(packageLockPath, 'package-lock.json');
        const rootPackageVersion = packageLock.packages?.['']?.version;
        if (packageLock.version !== currentVersion || rootPackageVersion !== currentVersion) {
            console.error('❌ Version mismatch between manifest.json and package-lock.json');
            console.error(`   manifest.json:            ${currentVersion}`);
            console.error(`   package-lock.json:        ${packageLock.version}`);
            console.error(`   package-lock root package: ${rootPackageVersion}`);
            console.error('   Align versions before releasing');
            process.exit(1);
        }
        console.log('✓ package-lock.json version matches manifest.json');
    }

    // Check required source-controlled files exist. Build artifacts are checked after verifyBuild().
    const requiredFiles = ['manifest.json', 'styles.css'];
    const missingRequiredFiles = requiredFiles.filter(file => !fs.existsSync(path.join(projectRoot, file)));

    if (missingRequiredFiles.length > 0) {
        console.error('❌ Required files missing:');
        missingRequiredFiles.forEach(file => console.error(`   - ${file}`));
        console.error('   Run build before releasing');
        process.exit(1);
    }
    console.log('✓ All required files exist');

    // Check GitHub Actions workflow exists
    const workflowPath = path.join(projectRoot, '.github', 'workflows', 'release.yml');
    if (!fs.existsSync(workflowPath)) {
        console.error('⚠️  Warning: GitHub Actions release workflow not found');
        console.error('   Expected: .github/workflows/release.yml');
        console.error('   Releases may need to be created manually');
    } else {
        console.log('✓ GitHub Actions workflow found');
    }

    // Validate manifest has required Obsidian fields
    const requiredManifestFields = ['id', 'name', 'version', 'minAppVersion', 'description', 'author'];
    const missingFields = requiredManifestFields.filter(field => !manifest[field]);

    if (missingFields.length > 0) {
        console.error('❌ manifest.json missing required fields:');
        missingFields.forEach(field => console.error(`   - ${field}`));
        process.exit(1);
    }
    console.log('✓ manifest.json has all required fields');

    console.log('\n✓ All pre-flight checks passed\n');
}

function validateReleaseNotes(version) {
    try {
        execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'mdReleaseNotes.js'), version], {
            cwd: projectRoot,
            stdio: 'ignore'
        });
    } catch (e) {
        console.error(`❌ Release notes missing for version ${version}`);
        console.error('   Add an entry to src/releaseNotes.ts before publishing');
        process.exit(1);
    }

    console.log(`✓ Release notes found for ${version}`);
}

// ============================================================================
// RELEASE OPERATIONS
// ============================================================================

function prepareRelease(releaseType, manifest, currentVersion, newVersion) {
    // Run all validations first
    validateReleaseReadiness(manifest, currentVersion);
    validateReleaseNotes(newVersion);
    checkVersionOverflow(...currentVersion.split('.').map(Number), releaseType);
    preReleaseChecks();
    checkExistingTag(newVersion);
    const releaseBranch = checkReleaseBranchAvailable(newVersion);

    // Create backups of files we're about to modify
    const filesToBackup = ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'];
    const backups = {};
    let currentCommit = null;
    let releaseBranchCreated = false;

    try {
        // Get current commit for potential rollback
        currentCommit = gitExecString(['rev-parse', 'HEAD']);
    } catch (e) {
        console.error('❌ Failed to get current commit:', e.message);
        process.exit(1);
    }

    for (const file of filesToBackup) {
        const filePath = path.join(projectRoot, file);
        if (fs.existsSync(filePath)) {
            try {
                backups[file] = fs.readFileSync(filePath, 'utf8');
            } catch (error) {
                console.error(`⚠️  Warning: Could not backup ${file}: ${error.message}`);
            }
        }
    }

    // Function to restore files in case of error
    const rollback = message => {
        console.error('\n🔄 Rolling back changes...');

        // Restore files
        Object.entries(backups).forEach(([file, content]) => {
            const filePath = path.join(projectRoot, file);
            try {
                fs.writeFileSync(filePath, content);
                console.error(`   ✓ Restored ${file}`);
            } catch (e) {
                console.error(`   ⚠️  Failed to restore ${file}: ${e.message}`);
            }
        });

        // Try to reset git if we made commits
        if (currentCommit) {
            try {
                const headCommit = gitExecString(['rev-parse', 'HEAD']);
                if (headCommit !== currentCommit) {
                    console.error('   Resetting git to previous commit...');
                    gitExecArray(['reset', '--hard', currentCommit]);
                    console.error('   ✓ Git reset complete');
                }
            } catch (e) {
                console.error('   ⚠️  Could not reset git:', e.message);
                console.error('   Run: git reset --hard ' + currentCommit);
            }
        }

        if (releaseBranchCreated) {
            try {
                gitExecArray(['checkout', 'main'], { stdio: 'ignore' });
                gitExecArray(['branch', '-D', releaseBranch], { stdio: 'ignore' });
                console.error(`   ✓ Removed local branch ${releaseBranch}`);
            } catch (e) {
                console.error(`   ⚠️  Could not remove local branch ${releaseBranch}:`, e.message);
            }
        }

        if (message) console.error(`\n❌ ${message}`);
        process.exit(1);
    };

    console.log(`\nPreparing release branch ${releaseBranch}`);
    console.log(`Bumping version from ${currentVersion} to ${newVersion}\n`);
    needsCleanup = true;

    try {
        gitExecArray(['checkout', '-b', releaseBranch], { stdio: 'inherit' });
        releaseBranchCreated = true;

        // Update manifest.json
        const manifestPath = path.join(projectRoot, 'manifest.json');
        const updatedManifest = { ...manifest, version: newVersion };
        writeJsonFile(manifestPath, updatedManifest);
        console.log('✓ Updated manifest.json');

        // Update package.json if it exists
        const packagePath = path.join(projectRoot, 'package.json');
        if (fs.existsSync(packagePath)) {
            let packageJson;
            try {
                packageJson = parseJsonFile(packagePath, 'package.json');
            } catch (e) {
                rollback(e.message);
            }
            if (!packageJson || typeof packageJson !== 'object') {
                rollback('package.json is not a valid object');
            }
            packageJson.version = newVersion;
            writeJsonFile(packagePath, packageJson);
            console.log('✓ Updated package.json');
        }

        // Update package-lock.json if it exists
        const packageLockPath = path.join(projectRoot, 'package-lock.json');
        if (fs.existsSync(packageLockPath)) {
            let packageLock;
            try {
                packageLock = parseJsonFile(packageLockPath, 'package-lock.json');
                updatePackageLockVersion(packageLock, newVersion);
            } catch (e) {
                rollback(e.message);
            }
            writeJsonFile(packageLockPath, packageLock);
            console.log('✓ Updated package-lock.json');
        }

        // Update versions.json
        const versionsPath = path.join(projectRoot, 'versions.json');
        let versionsJson = {};
        if (fs.existsSync(versionsPath)) {
            try {
                versionsJson = parseJsonFile(versionsPath, 'versions.json');
            } catch (e) {
                rollback(e.message);
            }
        }
        // Add new version with minimum required Obsidian version from original manifest
        versionsJson[newVersion] = manifest.minAppVersion;
        writeJsonFile(versionsPath, versionsJson);
        console.log('✓ Updated versions.json');
    } catch (error) {
        rollback(`Failed to update version files: ${error.message}`);
    }

    verifyBuild();

    // Git operations
    try {
        // Add only files that exist
        const filesToAdd = ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'].filter(file =>
            fs.existsSync(path.join(projectRoot, file))
        );
        assertOnlyExpectedChanges(filesToAdd);

        // Use array syntax to avoid shell injection
        gitExecArray(['add', ...filesToAdd], { stdio: 'inherit' });

        // Commit changes
        gitExecArray(['commit', '-m', `Bump version to ${newVersion}`], { stdio: 'inherit' });
        console.log('✓ Committed version changes');

        gitExecArray(['push', '-u', 'origin', releaseBranch], { stdio: 'inherit' });
        console.log(`✓ Pushed ${releaseBranch} to remote`);

        needsCleanup = false;

        if (isDryRun) {
            console.log(`\n🔍 DRY RUN COMPLETE - Release branch ${releaseBranch} would be prepared`);
        } else {
            createReleasePullRequest(releaseBranch, newVersion);
            gitExecArray(['checkout', 'main'], { stdio: 'inherit' });
            console.log(`\n✓ Release PR prepared for version ${newVersion}`);
            console.log('\nNext steps:');
            console.log('1. Wait for CI to pass on the release pull request');
            console.log('2. Merge the pull request into main');
            console.log('3. Run: node scripts/release.js\n');
        }
    } catch (error) {
        // If git operations fail, rollback file changes
        console.error('\n⚠️  Note: Git operations may have partially completed.');
        console.error('   Check git status and tags before retrying.');
        rollback(`Git operations failed: ${error.message}`);
    }
}

function createReleasePullRequest(releaseBranch, newVersion) {
    if (!commandAvailable('gh')) {
        console.log('⚠️  GitHub CLI not found; create the release pull request manually.');
        console.log(`   Branch: ${releaseBranch}`);
        return;
    }

    try {
        execFileSync(
            'gh',
            [
                'pr',
                'create',
                '--base',
                'main',
                '--head',
                releaseBranch,
                '--title',
                `Release ${newVersion}`,
                '--body',
                `Bumps release metadata to ${newVersion}.`
            ],
            { cwd: projectRoot, stdio: 'inherit' }
        );
        console.log('✓ Created release pull request');
    } catch (error) {
        console.log('⚠️  Could not create the release pull request automatically.');
        console.log(`   Create it manually from branch: ${releaseBranch}`);
    }
}

function publishRelease(manifest, currentVersion) {
    validateReleaseReadiness(manifest, currentVersion);
    validateReleaseNotes(currentVersion);
    preReleaseChecks();
    checkExistingTag(currentVersion);
    verifyBuild();

    try {
        gitExecArray(['tag', '-a', currentVersion, '-m', `Release ${currentVersion}`], { stdio: 'inherit' });
        console.log(`✓ Created tag ${currentVersion}`);

        gitExecArray(['push', 'origin', `refs/tags/${currentVersion}`], { stdio: 'inherit' });
        console.log(`✓ Pushed tag ${currentVersion}`);

        if (isDryRun) {
            console.log(`\n🔍 DRY RUN COMPLETE - Version ${currentVersion} would be published`);
        } else {
            console.log(`\n🎉 Successfully published version ${currentVersion}`);
            console.log('GitHub Actions will now build and publish the GitHub release.');
        }
    } catch (error) {
        console.error('\n❌ Publish failed:', error.message);
        console.error('   Check local tags and GitHub Actions before retrying.');
        process.exit(1);
    }
}

// ============================================================================
// USER INTERFACE
// ============================================================================

function showInteractivePrompt(currentVersion, versions) {
    console.log(`\nCurrent version: ${currentVersion}\n`);
    console.log('Select release type:');
    console.log(`  1) Patch (${currentVersion} → ${versions.patch}) [default]`);
    console.log(`  2) Minor (${currentVersion} → ${versions.minor})`);
    console.log(`  3) Major (${currentVersion} → ${versions.major})`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question(`\nEnter choice [1]: `, answer => {
        rl.close();

        // Use default if no answer provided
        const choice = answer.trim() || '1';

        let releaseType;
        switch (choice) {
            case '1':
                releaseType = 'patch';
                break;
            case '2':
                releaseType = 'minor';
                break;
            case '3':
                releaseType = 'major';
                break;
            default:
                console.error('❌ Invalid choice');
                process.exit(1);
        }

        prepareRelease(releaseType, manifest, currentVersion, versions[releaseType]);
    });
}

// ============================================================================
// LOCK FILE MANAGEMENT
// ============================================================================

function acquireLock() {
    if (isDryRun) return;

    try {
        while (true) {
            try {
                const fd = fs.openSync(lockFilePath, 'wx');
                try {
                    fs.writeFileSync(fd, process.pid.toString());
                } finally {
                    fs.closeSync(fd);
                }
                return;
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    throw error;
                }
            }

            const pid = fs.readFileSync(lockFilePath, 'utf8').trim();

            // Check if process is still running
            try {
                // This will throw if process doesn't exist
                // Note: On Windows, this might not work reliably for other users' processes
                process.kill(parseInt(pid), 0);
                console.error('❌ Another release process is already running (PID: ' + pid + ')');
                console.error('   If this is incorrect, delete ' + path.relative(process.cwd(), lockFilePath));
                process.exit(1);
            } catch (e) {
                // Process not running, remove stale lock
                console.log('⚠️  Removing stale lock file');
                fs.unlinkSync(lockFilePath);
            }
        }
    } catch (error) {
        console.error('❌ Failed to acquire lock:', error.message);
        process.exit(1);
    }
}

function releaseLock() {
    if (isDryRun) return;

    try {
        if (fs.existsSync(lockFilePath)) {
            const pid = fs.readFileSync(lockFilePath, 'utf8').trim();
            if (pid === process.pid.toString()) {
                fs.unlinkSync(lockFilePath);
            }
        }
    } catch (error) {
        console.error('⚠️  Failed to release lock:', error.message);
    }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

// Setup cleanup handler
process.on('SIGINT', () => {
    if (needsCleanup) {
        console.log('\n\n⚠️  Release interrupted!');
        console.log('   Check git status before retrying.');
    }
    releaseLock();
    process.exit(1);
});

process.on('exit', () => {
    releaseLock();
});

// Check prerequisites
checkGitAvailable();

// Parse command line arguments
const args = process.argv.slice(2);
let releaseTypeArg = null;

// Check for --dry-run flag
if (args.includes('--dry-run')) {
    isDryRun = true;
    console.log('🔍 Running in DRY RUN mode - no changes will be made\n');
    // Remove --dry-run from args
    const dryRunIndex = args.indexOf('--dry-run');
    args.splice(dryRunIndex, 1);
}

// Get release type from remaining args
if (args.length > 0) {
    releaseTypeArg = args[0];
}

const hasValidArg = releaseTypeArg && validReleaseTypes.includes(releaseTypeArg);

// Acquire lock before any operations (but never in --dry-run mode)
if (!isDryRun) {
    acquireLock();
}

syncMainForDefaultFlow(releaseTypeArg, isDryRun);

// Read and validate manifest
const manifestPath = path.join(projectRoot, 'manifest.json');
let manifest, currentVersion;

try {
    manifest = parseJsonFile(manifestPath, 'manifest.json');
    currentVersion = manifest.version;
} catch (error) {
    console.error('❌ Failed to read manifest.json');
    console.error(`   ${error.message}`);
    console.error('   Make sure you are running this script from the project directory');
    process.exit(1);
}

validateManifest(manifest);

// Parse and validate version numbers
const versionParts = currentVersion.split('.').map(Number);
validateVersionNumbers(versionParts);

const [major, minor, patch] = versionParts;

// Calculate new versions
const versions = {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`
};

// Execute release
if (hasValidArg) {
    // Direct release preparation mode
    prepareRelease(releaseTypeArg, manifest, currentVersion, versions[releaseTypeArg]);
} else if (releaseTypeArg) {
    console.error(`❌ Invalid release type: ${releaseTypeArg}`);
    console.error('   Use one of: patch, minor, major');
    console.error('\n   Usage: node release.js [patch|minor|major] [--dry-run]');
    process.exit(1);
} else {
    let tagStatus;
    try {
        tagStatus = getTagStatus(currentVersion);
    } catch (error) {
        console.error('❌ Failed to check whether the current version is already published:', error.message);
        process.exit(1);
    }

    const { localTagExists, remoteTagExists } = tagStatus;

    if (!localTagExists && !remoteTagExists) {
        console.log(`\nCurrent version ${currentVersion} is not tagged. Publishing merged release.`);
        publishRelease(manifest, currentVersion);
    } else {
        showInteractivePrompt(currentVersion, versions);
    }
}
