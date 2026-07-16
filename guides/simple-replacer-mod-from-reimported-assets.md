# 0007 - Simple Replacer Mod From Re-Imported Assets

This guide walks you through using blender for converting 
psk files into fbx files used with Unreal Engine.

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Open Import

Go to File > Import > Unreal PSK (.psk/.pskx)

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb701jfx64l.png)

## Step 2 - Import PSK Model at 0.01 Scale

Description

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6ysrm5cpw.png)

## Step 3 - Open Material

Description

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6wg9p3p8h.png)

## Step 4 - Set Base Color to Image Texture

Description

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6vmdq4o82.png)

## Step 5 - Open Folder to Select Texture

Description

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6tnap8o3u.png)

## Step 6 - Open/Import a Texture Image

Select an Image Texture then select "Open Image"
TIP: _S for the Specter is the default UV Map so it aligns properly while 
the _BC for Base Color uses a secondary UV Map before it shows properly.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6sxn0rfis.png)

## Step 7 - Rename Top Level to Armature

Change the Top Models level to Armature while retaining the 
models name at the lower level.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6m71wqxae.png)

## Step 8 - Recreate Shading Material for Reference

Add 2 UV Maps and connect to the Image Textures before connecting 
into the Principles BSDF to align the textures up properly in Blender.
TIP: Hold SHIFT + A to add new nodes such as:
Input > UV Map
Texture > Image Texture

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6jdttpp40.png)

## Step 9 - Open Export

Go to File > Export > FBX (.fbx)

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6f6zuzcbv.png)

## Step 10 - Export Model as FBX

Set the name of the export to match the name of the PSK we imported 
this will retain its structure and naming convention for import to UE.
Then select Export FBX to create your FBX file.
TIP: Only need Armature and Mesh in most cases.
Scale of 1.00 is okay for an export.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6ebxrb1fs.png)

## Step 11 - Import FBX of Model into Unreal Engine

Drag and drop the FBX file into the content browser while 
the folder structure is present for this model to be dropped 
in. Select Import All to create necessary assets from FBX.
TIP: If assets share same skeleton, then you can select it from 
the dropdown to link them together.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6bb69z3f6.png)

## Step 12 - Import Old Model

All assets will drop into one folder, make sure to move 
them into their proper locations like under Materials 
and/or Textures as needed.
TIP: Refer to FModel as a live reference to make sure.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb694i2r7zd.png)

## Step 13 - Import New Model

Follow same steps but with a new model. This is what we will 
move to be a replacer of existing/old model. We still need the 
materials and textures to line up but only the model with be in 
the packaged mode.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb68bqlzino.png)

## Step 14 - Move and Rename to Existing Asset (Rename Old if Present)

Rename model for the old model to have -old on the end. This
was simply a placeholder to identify name and structure. Then 
duplicate/move the new model into this folder with the name of 
the old model so it will be replaced.
TIP: Replacer Mods add in a new asset in the 
location of an existing asset to replace it.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb67fo624qc.png)

## Step 15 - Assign to Chunk

Right Click the Model and go to Asset Actions > Assign to Chunk
TIP: You can create collections to organize files across folders
and to also add a Primary Asset Label for auto-setting a ChunkID 
across a collection. A Primary Asset Label is created from a 
Miscellanious Data Asset.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb66tvlz7gj.png)

## Step 16 - Assign ChunkID

Set the ChunkID to something like 45 but make 
sure not to conflict with existing ones. ChunkIDs
have a tendency to conflict in some specific cases.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb66htq6nuc.png)

## Step 17 - Package Project

Go to Platforms > Windows > Package Project
TIP: Make sure Shipping is set

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb6618umesl.png)

## Step 18 - Packaging Complete

The packages will all be built at once 
creating multiple pakchunk files.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb65g1nwswh.png)

## Step 19 - Open Paks Folder from Build

Open Paks folder to access your pakchunk files

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb64glbnbpy.png)

## Step 20 - Rename packchunk files to your mod

Rename your 3 pakchunks for this mode to 
something unique for your mod but make sure
to set _P at the end before the file extension.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb63wl1tj6x.png)

## Step 21 - Add Mod Files to Game

Copy your mode files to be under the games 
Paks folder, typically  organized in a Mods
folder. Not to be confused with a Logics Mods 
folder that handles advanced logic.

![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb63568x26b.png)

Final Screenshots:
![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb627oceuck.png)
![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb62cksltkm.png)
![screenshot](uploads/simple-replacer-mod-from-reimported-assets/img_mrb62hexnbrf.png)

---

## What's next

- Installing UE4SS with Developer options and/or Tools like FModel

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.