# Flow diagrams

| File | What it shows |
| --- | --- |
| `sparta_process_flow.png` | The pilot process: the consumer recommendation engine (rules and ranking), consent and anonymised aggregation, the vendor decisions, course analytics, and the garment model built before the pilot |
| `data_flow_diagram.png` | The D2 data flow: the H&M files and Fashion-MNIST through the audit and cleaning to the cleaned dataset |
| `source/*.html` | The source of both diagrams |

Re-render a diagram with Chrome, for example:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1900,1290 --screenshot=sparta_process_flow.png source/process_flow.html
```

Use `--window-size=1700,1130` for `data_flow.html`.
