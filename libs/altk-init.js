let codeStr = ""

var Module = {
	'print': function (text) {
		console.log(text);
	},
	'printErr': function (text) {
		console.error(text);
	},
	'onRuntimeInitialized': function () {
		// look for scripts
		let scripts = document.getElementsByTagName('script');
		if (scripts.length != 0) {
			for (let i = 0; i < scripts.length; ++i) {
				if (scripts[i].getAttribute("type") == "heck") {
					compile_code = Module.cwrap('compile_code', 'string', ['string']);
					codeStr = compile_code(scripts[i].innerHTML);
					WabtModule().then(init);
					return;
				}
			}
		}
	}
}

let wat2wasm_script = document.createElement('script');
wat2wasm_script.setAttribute('src', 'https://webassembly.github.io/wabt/demo/libwabt.js');
document.head.appendChild(wat2wasm_script);

let heck_compiler_script = document.createElement('script');
heck_compiler_script.setAttribute('src', 'heck-compiler.js');
document.head.appendChild(heck_compiler_script);

/*
 * Copyright 2016 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var features = { exceptions: true, mutable_globals: true, sat_float_to_int: true, sign_extension: true, simd: true, threads: true, multi_value: true, tail_call: true, bulk_memory: true, reference_types: true };

function init(wabt) {

	var FEATURES = [
		'exceptions',
		'mutable_globals',
		'sat_float_to_int',
		'sign_extension',
		'simd',
		'threads',
		'multi_value',
		'tail_call',
		'bulk_memory',
		'reference_types',
	];

	var kCompileMinMS = 100;

	var binaryBuffer = null;
	var binaryBlobUrl = null;

	var wasmInstance = null;

	function debounce(f, wait) {
		var lastTime = 0;
		var timeoutId = -1;
		var wrapped = function () {
			var time = +new Date();
			if (time - lastTime < wait) {
				if (timeoutId == -1)
					timeoutId = setTimeout(wrapped, (lastTime + wait) - time);
				return;
			}
			if (timeoutId != -1)
				clearTimeout(timeoutId);
			timeoutId = -1;
			lastTime = time;
			f.apply(null, arguments);
		};
		return wrapped;
	}

	function compile() {
		var binaryOutput;
		try {
			var module = wabt.parseWat('main.wast', codeStr, features);
			module.resolveNames();
			module.validate(features);
			var binaryOutput = module.toBinary({ log: true, write_debug_names: true });
			//console.log(binaryOutput.log);
			binaryBuffer = binaryOutput.buffer;
			var blob = new Blob([binaryOutput.buffer]);
			if (binaryBlobUrl) {
				URL.revokeObjectURL(binaryBlobUrl);
			}
			binaryBlobUrl = URL.createObjectURL(blob);
			heck(binaryBuffer);
		} catch (e) {
			console.log("unable to compile code. Heck!")
		} finally {
			if (module) module.destroy();
		}
	}

	function heck(buffer) {
		const env = {
			memoryBase: 0,
			tableBase: 0,
			memory: new WebAssembly.Memory({
				initial: 256
			}),
			table: new WebAssembly.Table({
				initial: 0,
				element: 'anyfunc'
			})
		};

		/* makes sure there is not enough space
		  to store "amt" bytes at pos */
		function reserve_mem(mem, pos, amt) {
			if (pos + amt > mem.buffer.byteLength) {
				mem.grow(Math.ceil(amt / (2 ** 16)));
				//alert("grow " + Math.ceil(amt / (2**16)) + " page");
			}
		}

		// adds an array to memory at a given position
		// returns new pos
		function create_arr(mem, pos, size) {
			reserve_mem(mem, pos, 4 + size * 4);

			let view = new DataView(mem.buffer);

			// write size
			view.setUint32(pos, size, true);
			pos += 4;

			// initialize to zero
			let arr_pos = 0;
			while (arr_pos < size) {
				view.setUint32(pos, 0, true);
				pos += 4;
				++arr_pos;
			}
			return pos;
		}

		// adds an array to memory at a given position
		// returns new pos
		function create_arr_2d(mem, pos, width, height) {
			let arr_size = 4 + width * 4;
			if (height > 0) {
				arr_size += width * (4 + height * 4)
			}
			reserve_mem(mem, pos, arr_size);

			let view = new DataView(mem.buffer);

			// write size
			view.setUint32(pos, width, true);
			pos += 4;

			// initialize to zero
			let width_pos = 0;
			let height_pos = pos + width;
			while (width_pos < width) {
				let child_arr = 0;
				if (height > 0) {
					child_arr = height_pos;
					height_pos = create_arr(mem, height_pos, height);
				}
				view.setUint32(pos, child_arr, true);
				pos += 4;
				++width_pos;
			}
			return pos;
		}

		// adds a string to memory at a given position
		// returns new pos
		function create_str(mem, pos, js_str) {
			let str_buff = new TextEncoder("ascii").encode(js_str);
			reserve_mem(mem, pos, 4 + str_buff.length);

			let view = new DataView(mem.buffer);

			// write size
			view.setUint32(pos, str_buff.length, true);
			pos += 4;

			// write data
			let str_pos = 0;
			while (str_pos < str_buff.length) {
				view.setUint8(pos, str_buff[str_pos]);
				++pos;
				++str_pos;
			}
			return pos;
		}

		function arr_len(mem, arr) {
			// get the length in little-endian format (true)
			return new DataView(mem.buffer).getUint32(arr, true);
		}

		// load a altk string to js
		function altk_js_str(mem, str) {
			// get the string length in little-endian format (true)
			let str_size = new DataView(mem.buffer).getUint32(str, true);
			// get the string data
			let bytes = new Uint8Array(mem.buffer, str + 4, str_size);
			return new TextDecoder('utf8').decode(bytes);
		}

		let altk_memory = new WebAssembly.Memory({ initial: 2 });
		let alloc_pos = 2 * 2 ** 16; // start of the second page

		// function imports
		const imports = {
			_print_int: function (val) {
				console.log(val);
			},
			_print_float: function (val) {
				console.log(val);
			},
			_print_bool: function (val) {
				console.log(val == 0 ? false : true);
			},
			_print_string: function (val) {
				console.log(altk_js_str(altk_memory, val));
			},
			_rand_float: function () {
				return Math.random();
			},
			_rand_range: function (start, end) {
				return start + (Math.random() * (end - start));
			},
			input: function () {
				let str_pos = alloc_pos;
				alloc_pos = create_str(altk_memory, alloc_pos, prompt());
				return str_pos;
			},
			parseInt: function (str) {
				return parseInt(altk_js_str(altk_memory, str));
			},
			parseFloat: function (str) {
				return parseFloat(altk_js_str(altk_memory, str));
			},
			_concat_int_l: function (a, b) {
				let str_pos = alloc_pos;
				let str = altk_js_str(altk_memory, b);
				alloc_pos = create_str(altk_memory, alloc_pos, a + str);
				return str_pos;
			},
			_concat_int_r: function (a, b) {
				let str_pos = alloc_pos;
				let str = altk_js_str(altk_memory, a);
				alloc_pos = create_str(altk_memory, alloc_pos, str + b);
				return str_pos;
			},
			_concat_float_l: function (a, b) {
				let str_pos = alloc_pos;
				let str = altk_js_str(altk_memory, b);
				alloc_pos = create_str(altk_memory, alloc_pos, a + str);
				return str_pos;
			},
			_concat_float_r: function (a, b) {
				let str_pos = alloc_pos;
				let str = altk_js_str(altk_memory, a);
				alloc_pos = create_str(altk_memory, alloc_pos, str + b);
				return str_pos;
			},
			_concat_bool_l: function (a, b) {
				let str_pos = alloc_pos;
				let bool = a == 0 ? false : true;
				let str = altk_js_str(altk_memory, b);
				alloc_pos = create_str(altk_memory, alloc_pos, bool + str);
				return str_pos;
			},
			_concat_bool_r: function (a, b) {
				let str_pos = alloc_pos;
				let str = altk_js_str(altk_memory, a);
				let bool = b == 0 ? false : true;
				alloc_pos = create_str(altk_memory, alloc_pos, str + bool);
				return str_pos;
			},
			_concat_str: function (a, b) {
				let str_pos = alloc_pos;
				let str_a = altk_js_str(altk_memory, a);
				let str_b = altk_js_str(altk_memory, b);
				alloc_pos = create_str(altk_memory, alloc_pos, str_a + str_b);
				return str_pos;
			},
			_str_cmp: function (a, b) {
				let str_a = altk_js_str(altk_memory, a);
				let str_b = altk_js_str(altk_memory, b);
				if (str_a == str_b)
					return 1
				return 0
			},
			intArray: function (size) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr(altk_memory, alloc_pos, size);
				return arr_pos;
			},
			intArray2d: function (width, height) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr_2d(altk_memory, alloc_pos, width, height);
				return arr_pos;
			},
			floatArray: function (size) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr(altk_memory, alloc_pos, size);
				return arr_pos;
			},
			floatArray2d: function (width, height) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr_2d(altk_memory, alloc_pos, width, height);
				return arr_pos;
			},
			stringArray: function (size) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr(altk_memory, alloc_pos, size);
				return arr_pos;
			},
			stringArray2d: function (width, height) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr_2d(altk_memory, alloc_pos, width, height);
				return arr_pos;
			},
			boolArray: function (size) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr(altk_memory, alloc_pos, size);
				return arr_pos;
			},
			boolArray2d: function (width, height) {
				let arr_pos = alloc_pos;
				alloc_pos = create_arr_2d(altk_memory, alloc_pos, width, height);
				return arr_pos;
			},
			_string_len: function (str) {
				return arr_len(altk_memory, str);
			},
			_intArray_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_floatArray_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_stringArray_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_boolArray_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_intArray2d_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_floatArray2d_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_stringArray2d_len: function (arr) {
				return arr_len(altk_memory, arr);
			},
			_boolArray2d_len: function (arr) {
				return arr_len(altk_memory, arr);
			}
		};

		// other js imports
		const js = {
			mem: altk_memory
		};

		let finalImports;

		// add user imports
		if (altkImports != null) {
			let finalImports = Object.assign(imports, altkImports);
		}

		finalImports = imports;

		WebAssembly.instantiate(buffer, {
			env: env,
			imports: imports,
			js: js
		}).then(result => {
			//console.log(util.inspect(result, true, 0));
			console.log("finished running with exit code " + result.instance.exports.main());
		}).catch(e => {
			// error caught
			console.log(e);
		});
	}

	function run() {
		if (binaryBuffer === null) return;
		try {
			Altk(binaryBuffer);
		} catch (e) {
			//console.log(String(e));
			console.log("unable to run code.")
		}
	}

	compile();
}
