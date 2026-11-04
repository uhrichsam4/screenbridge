# ScreenBridge

ScreenBridge lets two computers in your home see each other's screens. Install it on
both computers (Mac or Windows). On one, press **Start sharing**. On the other, type the
address and password it shows, and press **Connect**. The shared screen opens in a
window, and you can use its mouse and keyboard.

It works over your own Wi-Fi. Nothing goes through the internet.

> **Only share on a network you trust (home Wi-Fi). The stream isn't encrypted.**
> Anyone on the same network who knows the password can watch and control the shared
> computer. Don't share on public Wi-Fi (cafes, hotels, airports).

## Download

Go to the [Releases](../../releases) page and download:

- **Mac** (Apple Silicon, M1 or newer): `ScreenBridge-…-mac-arm64.dmg`
- **Windows**: `ScreenBridge-Setup-….exe`

## First run

### Mac

1. Open the `.dmg` and drag **ScreenBridge** into **Applications**.
2. The first time, **right-click** ScreenBridge in Applications and choose **Open**, then
   **Open** again. (ScreenBridge isn't signed by Apple, so a normal double-click is
   blocked the first time. If there's no Open button, go to System Settings → Privacy &
   Security, scroll down and click **Open Anyway**.)
3. Press **Start sharing** once. macOS asks for permission:
   - **Screen Recording** (called *Screen & System Audio Recording*): turn on ScreenBridge.
   - **Accessibility**: turn on ScreenBridge. This lets the other computer use your mouse
     and keyboard.

   ScreenBridge has buttons that open the right settings page.
4. Quit ScreenBridge and open it again, then press **Start sharing**.

### Windows

1. Run `ScreenBridge-Setup-….exe`. If Windows shows "Windows protected your PC" (SmartScreen),
   click **More info**, then **Run anyway**.
2. The first time you press **Start sharing**, Windows Firewall asks whether to allow it.
   Tick **Private networks** and click **Allow**. Without this, the other computer can't
   connect.

## Share this computer

1. Press **Start sharing**.
2. ScreenBridge shows this computer's **address** (like `192.168.0.10`) and a
   **password** (like `abcd-efgh-jkmn`).
3. Type both into ScreenBridge on the other computer.
4. Press **Stop sharing** when you're done. Closing ScreenBridge also stops sharing.

The password stays the same until you press **New password**. Making a new one
disconnects anyone watching.

## Watch another computer

1. On the other computer, press **Start sharing**.
2. Here, type the **address** and **password** it shows, and press **Connect**.
3. The other screen opens in its own window. Close that window to disconnect.
   Press **F11** to switch full screen on and off.

If it can't connect: check both computers are on the same Wi-Fi, that the other one is
sharing, and (on Windows) that ScreenBridge was allowed through the firewall.

## Gaming

Leave **Game mode** on (it is by default) to play games on the other computer.

- **Click the stream** to lock the mouse into the window, so moving the mouse turns the
  camera like it does in the game.
- **Hold W and press P** to pause: the mouse is freed, held keys are let go and a
  Paused screen appears with **Resume** and **Leave**.
- **F11** switches full screen on and off.

Be aware: ScreenBridge streams over an ordinary (TCP) connection, which favors a
complete picture over the lowest delay. A wired (Ethernet) connection works best; on
Wi-Fi, use the 5 GHz network and stay close to the router. Fast competitive games may
feel a little behind.

## Credits

Built on [voxl](https://github.com/tembo/voxl) by tembo (MIT). ScreenBridge is MIT
licensed too, see [LICENSE](LICENSE).

## Build from source

You need Node.js 22+, Rust, and on a Mac Homebrew.

```sh
git clone --recursive <this repo>
cd screenbridge
bash scripts/apply-voxl-patches.sh

# Mac
brew install x264 opus pkgconf esbuild
(cd voxl && cargo build --release)
bash scripts/prepare-voxl-mac.sh voxl/target/release/voxl
npm ci
npm start            # run it
npm test             # share and forwarding test (uses port 6911)
npm run dist:mac     # dist/ScreenBridge-…-mac-arm64.dmg
```

On Windows, build `voxl.exe` with vcpkg (`x264 libyuv opus`, triplet
`x64-windows-static-md`) and LLVM as in `.github/workflows/build.yml`, copy it to
`resources\bin\voxl.exe`, then run `npm ci` and `npm run dist:win`.

Set `SCREENBRIDGE_PORT` to share on a port other than 6901.
