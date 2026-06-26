# Push the project from the PC to the G1 Jetson (~/robostore-control).
# Uses tar-over-ssh via cmd so the binary stream isn't mangled by PowerShell pipes.
# node_modules/ and dist/ only ever exist on the robot, so nothing is clobbered.

cmd /c "tar -cf - -C ""%USERPROFILE%"" robostore-control | ssh unitree@192.168.123.164 ""tar -xf - -C ~ && echo SYNCED"""
