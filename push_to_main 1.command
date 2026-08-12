#!/bin/bash
cd "/Users/niallbell/Library/Mobile Documents/iCloud~md~obsidian/Documents/Niall's Cave v2" || exit 1

git add .
git commit -m "Web content update"
git push origin main

echo ""
echo "Done. Press any key to close..."
read -n 1
