# Vendored emulator gRPC proto

`emulator_controller.proto` is copied **verbatim** from AOSP and is licensed
Apache-2.0 (the original header is retained in the file).

- **Source:** `platform/external/qemu`, branch `emu-master-dev`,
  `android/android-grpc/services/emulator-controller/proto/emulator_controller.proto`
- **Fetched:** 2026-07-16
- **Verified against:** Android emulator 36.5.11.0

## Why it is vendored

The emulator does not ship this file to the SDK, so it cannot be read from
`$ANDROID_HOME` at runtime. It is imported with `?raw` and parsed by protobufjs
at runtime (see `../EmulatorControllerClient.ts`), which inlines it into the
main bundle — no packaging step or codegen is required.

## Updating

Re-fetch the file, keep the Apache header, and re-run
`tests/integration/emulatorGrpc.test.ts` — it stands up a real gRPC server from
this proto and round-trips every message the app uses, so a breaking upstream
change fails there rather than at runtime.

Note: the only `import` this file makes is `google/protobuf/empty.proto`, which
is string-substituted for a local `Empty` message at parse time so the proto
resolves standalone. If upstream adds another import, that substitution needs to
grow to match.
