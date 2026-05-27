#!/usr/bin/env nu

# Clone the docs-website repo into .docs-repo/ and symlink docs/ into its
# CLI content directory, so the markdown authored here lives natively in
# the Starlight content root.
#
# Idempotent: safe to re-run. To live-preview docs:
#   cd .docs-repo && npm install && npm run dev

def main [
    --repo: string = "git@github.com:Promptless/promptless.ai.git",
    --branch: string = "main",
    --clone-dir: string = ".docs-repo",
    --content-subdir: string = "src/content/docs/docs/cli",
] {
    let repo_root = (git rev-parse --show-toplevel | str trim)
    cd $repo_root

    if ("docs" | path type) == "symlink" {
        print "docs/ is already a symlink; nothing to do."
        return
    }

    if not ($clone_dir | path exists) {
        print $"Cloning ($repo) into ($clone_dir) ..."
        git clone --branch $branch $repo $clone_dir
    } else {
        print $"($clone_dir) already exists; skipping clone."
    }

    let target = $"($clone_dir)/($content_subdir)"
    if not ($target | path exists) {
        print $"Creating ($target) ..."
        mkdir $target
    }

    mut migrated = 0
    if ("docs" | path exists) and (("docs" | path type) == "dir") {
        let entries = (ls docs | get name)
        for entry in $entries {
            let dest = $"($target)/(($entry | path basename))"
            if ($dest | path exists) {
                print $"  skip: ($entry) -> ($dest) already exists"
            } else {
                mv $entry $dest
                print $"  ($entry) -> ($dest)"
                $migrated = $migrated + 1
            }
        }
        rm -r docs
    }

    ln -s $"($clone_dir)/($content_subdir)" docs
    print $"Symlinked docs -> ($clone_dir)/($content_subdir)"

    print ""
    print "Next steps:"
    if $migrated > 0 {
        print $"  - ($migrated) file\(s\) moved into the clone; commit them in ($clone_dir)"
        print $"  - commit the corresponding deletions in this repo"
    }
    print $"  - to preview: cd ($clone_dir) && npm install && npm run dev"
}
