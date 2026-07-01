' start-control-panel-hidden.vbs
' Silent launcher for WebAI LocalBridge.
' Double-click this file (or a shortcut pointing to it) to start the
' control panel without any visible console window.
'
' What this script does:
'   1. Checks whether port 33004 is already listening.
'   2. If NOT listening -> starts node control-panel-v2.js (hidden window).
'   3. Waits a moment, then opens http://127.0.0.1:33004 in the default browser.
'   4. If ALREADY listening -> just opens the browser (no duplicate process).
'
' Shortcut setup:
'   Name:     WebAI LocalBridge.lnk
'   Target:   wscript.exe
'   Arguments: "{installDir}\start-control-panel-hidden.vbs"
'   Start in: {installDir}
'   Icon:     resources\brand\webai-localbridge-icon.ico

Option Explicit

Dim shell, fso, projectDir, checkCmd, rc, cmd, nodeExe
Dim i, portListening

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Validate project directory exists
If Not fso.FolderExists(projectDir) Then
    MsgBox "Project directory not found:" & vbCrLf & projectDir, vbCritical, "WebAI LocalBridge startup error"
    WScript.Quit 1
End If

' Check if port 33004 is already listening
checkCmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command ""if (Get-NetTCPConnection -LocalPort 33004 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"""
rc = shell.Run(checkCmd, 0, True)

If rc <> 0 Then
    ' Port 33004 not listening -> start control panel (hidden window)
    ' Prefer the bundled Node runtime, fall back to PATH node
    nodeExe = projectDir & "\runtime\node\node.exe"
    If fso.FileExists(nodeExe) Then
        cmd = "cmd /c cd /d " & Chr(34) & projectDir & Chr(34) & " && " & Chr(34) & nodeExe & Chr(34) & " control-panel-v2.js"
    Else
        cmd = "cmd /c cd /d " & Chr(34) & projectDir & Chr(34) & " && node control-panel-v2.js"
    End If
    shell.Run cmd, 0, False

    ' Wait up to 10 seconds for port 33004 to become listening
    portListening = False
    For i = 1 To 20
        WScript.Sleep 500
        rc = shell.Run(checkCmd, 0, True)
        If rc = 0 Then
            portListening = True
            Exit For
        End If
    Next

    If portListening Then
        ' Control panel is up -> open browser
        shell.Run "http://127.0.0.1:33004", 0, False
    Else
        MsgBox "Control panel started but port 33004 is not listening after 10 seconds." & vbCrLf & _
               "Check the log file for errors.", vbExclamation, "WebAI LocalBridge startup warning"
    End If
Else
    ' Port 33004 already listening -> just open browser
    shell.Run "http://127.0.0.1:33004", 0, False
End If
