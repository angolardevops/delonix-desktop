import { describe, expect, it } from "vitest";
import { MockClient } from "./mockClient";

// Lógica pura do lado TS: o duplo local honra o contrato de VM do socket
// (list/create/start/stop/delete + snapshots list/create). Mantém os tipos
// normalizados que a UI consome (VmDetail/VmSnapshot).
describe("MockClient — VMs pelo socket node.v1", () => {
  it("lista as VMs dos workloads com forma VmDetail", async () => {
    const vms = await new MockClient().vmList();
    expect(vms.length).toBeGreaterThan(0);
    const running = vms.find((v) => v.name === "fc-ci-runner-1");
    expect(running?.phase).toBe("VIRTUAL_MACHINE_PHASE_RUNNING");
    expect(running?.vcpus).toBe(2);
    expect(running?.memoryBytes).toBe(1024 ** 3);
    const stopped = vms.find((v) => v.name === "fedora-kde-build");
    expect(stopped?.phase).toBe("VIRTUAL_MACHINE_PHASE_STOPPED");
    expect(stopped?.ipAddresses).toEqual([]);
  });

  it("cria uma VM e passa a listá-la", async () => {
    const c = new MockClient();
    await c.vmCreate({ name: "nova-vm", image: "u.qcow2", vcpus: 4, memoryBytes: 4 * 1024 ** 3, diskBytes: 20 * 1024 ** 3, network: "ingress" });
    const got = await c.vmGet("nova-vm");
    expect(got.vcpus).toBe(4);
    expect(got.phase).toBe("VIRTUAL_MACHINE_PHASE_RUNNING");
  });

  it("parar/iniciar/remover mudam o estado observável", async () => {
    const c = new MockClient();
    await c.vmStop("fc-ci-runner-1");
    expect((await c.vmGet("fc-ci-runner-1")).phase).toBe("VIRTUAL_MACHINE_PHASE_STOPPED");
    await c.vmStart("fc-ci-runner-1");
    expect((await c.vmGet("fc-ci-runner-1")).phase).toBe("VIRTUAL_MACHINE_PHASE_RUNNING");
    await c.vmDelete("fc-ci-runner-1");
    await expect(c.vmGet("fc-ci-runner-1")).rejects.toThrow();
  });

  it("cria e lista snapshots de uma VM", async () => {
    const c = new MockClient();
    await c.vmSnapshotCreate("fc-ci-runner-2", "antes-da-atualizacao");
    const snaps = await c.vmSnapshotList("fc-ci-runner-2");
    const s = snaps.find((x) => x.name === "antes-da-atualizacao");
    expect(s).toBeTruthy();
    expect(s?.includesMemory).toBe(true); // a VM estava a correr
  });
});
