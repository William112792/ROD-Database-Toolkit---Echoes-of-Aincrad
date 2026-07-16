# 0000 - Generating AES Key and Mapping Files

This guide walks you through pulling the AES encryption key 
in addition to needed mapping files for modding.

> Screenshot placeholders below render as dashed boxes until real images are added.
> To replace one: open this guide in **Edit**, put your cursor on the placeholder
> line, delete it, and paste (Ctrl+V) or drag & drop your screenshot — the image
> uploads automatically and appears exactly where you dropped it.

---

## Step 1 — Find Game Shipping Executable

Go to the game directory and browse down to 
Echoes of Aincrad Demo\EchoesofAincrad\Binaries\Win64
to find : EchoesofAincrad-Win64-Shipping.exe

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbbcv1rs629.png)

## Step 2 — Upload Shipping executable

Go to [https://illusory.dev/aesdumpster/](https://illusory.dev/aesdumpster/) and drag the Shipping file from 
your game on to the "Drag & Drop" section of the page.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbbczxawulz.png)

## Step 3 — Wait for Key Scanner to complete

The Key Scanner will analyze the file to identify 
the AES key in this specific Shipping executable.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbbd4w49upa.png)

## Step 4 — Copy AES Key in 0x format

Now that you have the AES key info the assets 
key be decrypted but will still need a mappings 
file to access the content.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbbd9is69el.png)

## Step 5 - Build Dumper 7 DLL

Clone and open Dumper 7 in Visual Studio, then right 
click and select Build.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbe6elmian7.png)

## Step 6 - Confirm Build Successful

The tail of the output should show a Build: 1 succeeded

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbe74zl2msd.png)

## Step 7 - Locate the DLL

In the Dumper-7 folder under x64\Debug should be the 
Dumper-7.dll that we will be using.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbe8gtjh2f9.png)

## Step 8 - Launch Cheat Engine and select Process

Open Cheat Engine and select process by opening the EchoesofAincrad-Win64-Shipping.exe 
that is currently running as an open process.
TIP: Game has to be running to see its process.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbe9usdxa1q.png)

## Step 9 - Open Memory View

Select the Memory View button to access the 
Memory Viewer which is needed to inject DLLs.
TIP: Press CTRL + B to open Memory Viewer

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbebln5uw3e.png)

## Step 10 - Open Lua Engine for injection

In Memory Viewer, press CTRL + L to open the Lua Engine

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbedkl3ugu0.png)

## Step 11 - Inject the DLL into memory

Type InjectDLL and the path to your Dumper-7.dll file
including double slashes per folder before selecting Execute.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbeglxj1qs0.png)

## Step 13 - Optional: UE4SS Console confirmation

If UE4SS is running in Developer mode with console visible 
then you will see the Generated output for the mapping files.

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbeig6bh4vb.png)

## Step 14 - Locate USMAP mapping file

The usmap mapping file will be generated on your system drive which 
typically will be under C:\Dumper-7 in a folder called Mappings

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbejgn36eow.png)

## Step 15 - Locate IDA mapping file

The ida mapping file will be generated on your system drive which 
typically will be under C:\Dumper-7 in a folder called IDAMappings

![screenshot](uploads/generating-aes-key-and-mapping-files/img_mrbek08uqj2e.png)

---

## What's next

- Importing assets extracted with this toolkit — see the Asset Inspector and the
  per-asset download buttons for `psk`/`fbx`/`blend` files
- Repacking and testing in-game
- Installing UE4SS with Developer options and/or Tools like FModel

> Tip: the toolkit's **Data Coverage** page lists exactly which game data is
> confirmed vs. inferred — check it before relying on any value in your mod.