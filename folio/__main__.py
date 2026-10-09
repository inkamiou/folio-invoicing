import sys

if sys.platform == "win32":
    from folio.winwindow import main
else:
    from folio.window import main

main()
