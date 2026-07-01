# ROD Database Toolkit
### Echoes of Aincrad Reverse Engineering Toolkit

![Platform](https://img.shields.io/badge/Platform-Web-blue)
![Node.js](https://img.shields.io/badge/Node.js-Supported-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-Supported-3776AB?logo=python&logoColor=white)
![Offline](https://img.shields.io/badge/Offline-Yes-success)
![Status](https://img.shields.io/badge/Status-Active-success)
![Fan Project](https://img.shields.io/badge/Fan_Project-Unofficial-orange)

An offline toolkit for exploring, analyzing, and browsing **Echoes of Aincrad** game data.

Designed for **modders**, **reverse engineers**, and **players**, the toolkit allows you to inspect game databases, analyze equipment, browse extracted assets, and regenerate application content from extracted game files—all without requiring the game to be running.

---

# Preview

> Screenshots coming soon.

---

# Features

## Equipment Browser

- Browse weapons and armor
- Equipment stat analysis
- Enhancement simulation
- Ability stat calculator
- EX-MOD simulation

## Encyclopedia

Browse game information including:

- Equipment
- Items
- Recipes
- Characters
- Monsters
- World Lore

## Asset Inspector

Explore extracted game assets including:

- Materials
- Meshes
- Audio Events
- Data Tables
- Blueprints
- Generated JSON

## Mod Development

Designed around an offline workflow for modding and research.

- Browse extracted game assets
- Generate application data
- Import updated game files
- Rebuild content through the Build Dashboard
- No external database required

## Localization

- Multiple language support
- Instantly switch languages
- Browse localized game content

---

# Download

Download the latest release from the GitHub Releases page.

**Latest Release**

https://github.com/William112792/ROD-Database-Toolkit---Echoes-of-Aincrad/releases/latest

---

# Quick Start

The toolkit only needs to be served over HTTP. Use whichever runtime you already have installed.

## Node.js

```bash
npm install
npm start
```

## Python

```bash
python3 serve.py
```

Open your browser to:

```
http://localhost:8000
```

---

# Build Dashboard

The included Build Dashboard simplifies updating the toolkit with newly extracted game data.

Supported workflows include:

- Import extracted game files
- Regenerate application content
- Update localization
- Refresh generated databases

The Build Dashboard powers the application's generated content while remaining optional for users who simply want to browse existing data.

---

# Project Structure

```
app/
Content/
raw-export/
tools/

server.js
serve.py
package.json
README.md
```

---

# Documentation

Additional documentation is available throughout the repository.

| Document | Description |
|----------|-------------|
| DESIGN.md | User interface design and styling |
| BUILD.md | Build pipeline documentation |
| FEATURES.md | Detailed feature reference |
| TRANSCRIPT.md | Reverse engineering research and findings |

---

# Included Tools

| Tool | Purpose |
|------|---------|
| Equipment Browser | Browse and analyze equipment |
| Encyclopedia | Browse game databases |
| Asset Inspector | Explore extracted assets |
| DT Inspector | Browse DataTables |
| BP Inspector | Inspect Blueprint metadata |
| JSON Inspector | View generated application data |
| Build Dashboard | Generate application content |

---

# Intended Audience

This project is useful for:

- Mod developers
- Reverse engineers
- Data miners
- Unreal Engine researchers
- Players interested in game mechanics

---

# Contributing

Bug reports, feature requests, pull requests, and reverse engineering discoveries are welcome.

If you've discovered new game structures or improved extraction methods, contributions are appreciated.

---

# Disclaimer

This project is an unofficial fan-made toolkit.

Echoes of Aincrad, Sword Art Online, and all associated assets, trademarks, and copyrights belong to their respective owners.

This repository exists for educational, preservation, and modding purposes only.
