# 0004 - Brief Understanding of Pak, Ucas, and Utoc

This guide provides a little more details into chunks,
packages, builds, and assets focusing on the Paks folder.

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Fresh Packaged Build for Modding

By default you will be using a ChunkID of 0 which is usually used by the base game 
along with other separate chunks as the developers need for separating content.
As you develop and assign ChunkIDs you will see new pakchunk files that you will 
rename to your mod name which we will go into more detail in guides.

TIP: Files containing _P at the end are considered patches for patching/updating 
content in the base game. Your mods will follow this standard retaining each file 
type such as pak, ucas, and utoc.

![screenshot](uploads/brief-understanding-of-pak-ucas-utoc/img_mrar6s6wvk3e.png)

## Step 2 — Game Packaged Build

The game will have various pakchunk files using a standard such as ChunkID 0 and 1 
but they may use additional ones across languages or platforms/consoles such as 
10 - 18 but this varies by developer.

TIP: It is suggested to use chunk IDs from 40+ when modding but you will want to 
try to use unique ChunkIDs where possible.

![screenshot](uploads/brief-understanding-of-pak-ucas-utoc/img_mrar82zqsz7u.png)

## Step 3 — What is Pak, Ucas and Utoc?

Pak files are the initial standard for packaging and cooking Unreal Assets referred to as uasset files.
Ucas and Utoc is a new Io Store Standard for providing an Unreal Table of Contents (UTOC) and an 
Unreal Content Addressed Storage (UCAS) on top of the existing Packaging Standard

## Step 4 — How does this apply to the game?

All assets are stored within these files from Pawns/Characters/Actors to Blueprints/Widgets to Materials/Instances/Textures to Models/Meshes/Skeletons/Physics to DataTables/DataAssets to NiagaraEffects to Audio (typically Wwise) and so forth.
Exploring these files can lead to understanding of game structure, parent to child inheritance, variables and functions 
used in the game. This knowledge leads to new mods by replacing content, injecting new contents, or removing/modifying content.

---

## What's next

- Importing assets extracted with this toolkit — see the Asset Inspector and the
  per-asset download buttons for `psk`/`fbx`/`blend` files
- Repacking and testing in-game
- Installing UE4SS with Developer options and/or Tools like FModel

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.