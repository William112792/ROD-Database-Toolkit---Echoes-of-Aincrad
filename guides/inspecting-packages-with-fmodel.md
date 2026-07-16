# 0005 - Inspecting Packages with FModel

This guide walks you through accessing archive packages 
via a mappings file and AES encryption/decryption.

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Download FModel

Find a trusted source of FModel like you would find at 
[https://fmodel.app/](https://fmodel.app/) but be careful as custom versions exist 
and has some risk to knowing what you are downloading and 
from where.

## Step 2 — Define Directory Selector

The Directory Selector is for browsing the Paks files including 
Ucas and Utoc all within the games Paks folder. Set this to the 
Directory under your games installation path and set the UE 
Version to GAME_UE5_3 which supports 5.3.2

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb23yglrsh1.png)

## Step 3 — Add Undetected Game

If you don't have these fields predefined or have multiple installs 
you can use the Add Undetected Game to find new game entries and 
select the + to add them to the list for the previous step.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb24lp6itrv.png)

## Step 4 — Add AES key to Directory

Under Directory, select AES

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb257zjs506.png)

## Step 5 — Set the AES key via AES Manager

Copy the AES encryption key from an external source to the 
Main Static Key in the AES Manager for decrypting content.
Select OK to close this window.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb269ldw92z.png)

## Step 6 — Open Settings

Select Settings to open the Settings Window

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb2768grrxr.png)

## Step 7 — Check and Set Local Mapping Files

In Settings, under General, check Local Mapping File and
define the path to your USMAP mapping file under Mapping 
File Path.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb27qvhqzag.png)

## Step 8 — Set Output Directory

In Settings, under General, set the Output Directory to 
an empty folder where you can export assets like textures, 
properties, audio, and so forth.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb280c0sfgr.png)

## Step 9 — Set Model Export Directory

In Settings, under Models, set the Model Export Directory to 
an empty folder where you can export assets like meshes, skeletons, 
textures, and so forth.
TIP: I typically put this in an Exports folder under the folder from the 
previous step so assets are exported together

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb29pklcjb3.png)

## Step 10 — Opening Archives

The Paks folder will typically have a really large files where you 
will pull most of the games content such as pakchunk0-WindowsClient.utoc
but other files still contain assets like pakchunk0-WindowsClient.pak

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb2a5j5tyk7.png)

## Step 11 — ROD Folder Structure

Most assets will be under EchoesofAincrad > Content > ROD
And you will replicate this structure in your project using the 
existing Content folder present in your project.
TIP: Localization is built into the project so that folder 
structure can't be recreated and would be cooked into ChunkID 0.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb2bzle97me.png)

## Step 12 — Expanded ROD Folder Structure

As you explore the ROD folder, you will find CHR, DataAssets, ITM 
and Widget contain a lot of the DataTables, DataAssets, and Models.
TIP: Check out DataAssets for understanding the lists and references
the logic of the game gets build around.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb2c4bvku80.png)

## Step 13 — Localization for Language Translation

The Localization is what handles the language translation and 
has a list of each name, description, and strings in general 
that change per language selected.

![screenshot](uploads/inspecting-packages-with-fmodel/img_mrb2c93rc3nw.png)

---

## What's next

- Extracting your own assets for `psk`/`fbx`/`blend` files
- Repacking and testing in-game
- Installing UE4SS with Developer options

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.