import AppKit
import Darwin
import Foundation

private func commandOutput(_ executable: String, _ arguments: [String]) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        process.waitUntilExit()
        return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    } catch {
        return ""
    }
}

final class NornsLabMenu: NSObject, NSApplicationDelegate {
    private let projectPath: String
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let status = NSMenuItem(title: "Checking…", action: nil, keyEquivalent: "")
    private let startItem = NSMenuItem(title: "Start and Open", action: #selector(start), keyEquivalent: "")
    private let openItem = NSMenuItem(title: "Open Browser", action: #selector(openBrowser), keyEquivalent: "")
    private let stopItem = NSMenuItem(title: "Stop Emulator", action: #selector(stop), keyEquivalent: "")
    private var timer: Timer?
    private var serverProcess: Process?
    private var logHandle: FileHandle?
    private var openWhenReady = false

    init(projectPath: String) {
        self.projectPath = projectPath
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        menu.addItem(status)
        menu.addItem(.separator())
        for item in [startItem, openItem, stopItem] {
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())
        let logItem = NSMenuItem(title: "View Log", action: #selector(viewLog), keyEquivalent: "")
        logItem.target = self
        menu.addItem(logItem)
        let quitItem = NSMenuItem(title: "Stop and Quit", action: #selector(stopAndQuit), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)
        statusItem.menu = menu
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refresh() }
    }

    private func listeningPID() -> Int? {
        let text = commandOutput("/usr/sbin/lsof", ["-nP", "-iTCP:5151", "-sTCP:LISTEN", "-t"])
        return text.split(whereSeparator: \.isNewline).compactMap { Int($0) }.first
    }

    private func nornsPID() -> Int? {
        guard let pid = listeningPID() else { return nil }
        let cwd = commandOutput("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
        let process = commandOutput("/bin/ps", ["-p", String(pid), "-o", "command="])
        guard cwd.split(whereSeparator: \.isNewline).contains("n\(projectPath)"),
              process.contains("node src/server.js") else { return nil }
        return pid
    }

    private func refresh() {
        let running = nornsPID() != nil
        let busy = !running && listeningPID() != nil
        status.title = running ? "Running" : busy ? "Port 5151 is in use" : "Stopped"
        statusItem.button?.title = running ? "● Norns Lab" : "○ Norns Lab"
        startItem.isEnabled = !running && !busy
        openItem.isEnabled = running
        stopItem.isEnabled = running
        if running && openWhenReady {
            openWhenReady = false
            openBrowser()
        }
    }

    @objc private func start() {
        guard nornsPID() == nil, listeningPID() == nil else { refresh(); return }
        let logs = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/NornsLab.log")
        FileManager.default.createFile(atPath: logs.path, contents: nil)
        guard let log = FileHandle(forWritingAtPath: logs.path) else { return }
        log.seekToEndOfFile()
        logHandle = log
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "exec node src/server.js"]
        process.currentDirectoryURL = URL(fileURLWithPath: projectPath)
        process.standardOutput = log
        process.standardError = log
        do {
            try process.run()
            serverProcess = process
            openWhenReady = true
            status.title = "Starting…"
        } catch {
            let alert = NSAlert()
            alert.messageText = "Could not start Norns Lab"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    @objc private func openBrowser() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:5151/")!)
    }

    @objc private func stop() {
        openWhenReady = false
        guard let pid = nornsPID() else { refresh(); return }
        _ = Darwin.kill(pid_t(pid), SIGTERM)
        status.title = "Stopping…"
    }

    @objc private func viewLog() {
        let logs = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/NornsLab.log")
        NSWorkspace.shared.open(logs)
    }

    @objc private func stopAndQuit() {
        stop()
        NSApp.terminate(nil)
    }
}

guard let projectPath = Bundle.main.object(forInfoDictionaryKey: "NornsLabProjectPath") as? String else {
    fatalError("Norns Lab project path is missing from the app bundle")
}
let app = NSApplication.shared
let delegate = NornsLabMenu(projectPath: projectPath)
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
