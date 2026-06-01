/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/*============================================================================*
 *               Define to prevent recursive inclusion
 *============================================================================*/
#ifndef __GUI_CINEPAK_H__
#define __GUI_CINEPAK_H__

#ifdef __cplusplus
extern "C" {
#endif

/*============================================================================*
 *                        Header Files
 *============================================================================*/
#include "guidef.h"
#include "gui_api.h"
#include "draw_img.h"
#include "gui_img.h"
#include "gui_fb.h"
#include "gui_video.h"       /* GUI_VIDEO_STATE / GUI_VIDEO_REPEAT_INFINITE */
#include "cinepak_decoder.h"

/*============================================================================*
 *                         Types
 *============================================================================*/

/**
 * @brief  gui_cinepak widget -- plays an AVI file encoded with Cinepak (CVID).
 *
 * Architecture mirrors gui_msv1:
 *  - Inherits gui_obj_t (base)
 *  - Creates a child gui_img_t for on-screen rendering
 *  - Internal timer advances frame_cur every frame_time ms
 *  - AVI chunks are indexed at creation time; each draw call reads one chunk,
 *    decodes it with cinepak_decoder, and updates gui_img.
 *
 * Key differences from gui_msv1:
 *  - No palette (Cinepak always outputs RGB565 directly via YUV conversion)
 *  - Output is top-down (no vertical flip required)
 *  - No bits_per_pixel selection (decoder always produces RGB565)
 */
typedef struct gui_cinepak
{
    gui_obj_t            base;
    gui_img_t           *img;           /**< child image widget used for rendering      */

    void                *data;          /**< source: RAM pointer, FTL base, or FS path  */
    uint32_t             num_frame;     /**< total video frame count                    */
    uint8_t              storage_type;  /**< IMG_SRC_MEMADDR / IMG_SRC_FTL / IMG_SRC_FILESYS */

    gui_rgb_data_head_t  header;        /**< image header template (RGB565, w, h, ...)  */
    uint8_t             *render_buf;    /**< header + RGB565 pixels, allocated once     */

    cinepak_decoder_t   *decoder;       /**< stateful Cinepak codec                     */

    uint32_t             frame_time;    /**< ms between frames (from AVI usec_per_frame) */
    uint32_t             frame_step;    /**< frames to advance per tick (default 1)     */
    int32_t              frame_cur;     /**< current frame index (-1 = not yet started) */
    int32_t              frame_last;    /**< last rendered frame (cache control)        */
    int32_t              repeat_cnt;    /**< remaining repeats; -1 = infinite           */

    uint8_t              state;         /**< GUI_VIDEO_STATE_*                          */

    void                *chunks;        /**< CvidChunk_t[], indexed at init             */
    uint32_t             chunk_num;     /**< number of entries in chunks[]              */
    uint32_t             frame_chunk_cur; /**< AVI chunk index of last non-empty frame  */
} gui_cinepak_t;

/*============================================================================*
 *                         Functions
 *============================================================================*/

/**
 * @brief Create a Cinepak widget from a memory buffer (AVI file in RAM/Flash).
 *
 * @param parent  Parent GUI object.
 * @param name    Widget name string.
 * @param addr    Pointer to the AVI data in memory.
 * @param x       Left edge position relative to parent.
 * @param y       Top edge position relative to parent.
 * @param w       Initial width hint (overwritten by the AVI frame size).
 * @param h       Initial height hint (overwritten by the AVI frame size).
 * @return        Pointer to the widget, or NULL on failure.
 */
gui_cinepak_t *gui_cinepak_create_from_mem(void *parent, const char *name, void *addr,
                                           int16_t x, int16_t y, int16_t w, int16_t h);

/**
 * @brief Create a Cinepak widget from the virtual filesystem.
 *
 * @param parent  Parent GUI object.
 * @param name    Widget name string.
 * @param path    File path string in the VFS (e.g. "/video/sample.avi").
 * @param x       Left edge position relative to parent.
 * @param y       Top edge position relative to parent.
 * @param w       Initial width hint.
 * @param h       Initial height hint.
 * @return        Pointer to the widget, or NULL on failure.
 */
gui_cinepak_t *gui_cinepak_create_from_fs(void *parent, const char *name, void *path,
                                          int16_t x, int16_t y, int16_t w, int16_t h);

/**
 * @brief Create a Cinepak widget from FTL (Flash Translation Layer) storage.
 *
 * @param parent  Parent GUI object.
 * @param name    Widget name string.
 * @param addr    FTL base address of the AVI data.
 * @param x       Left edge position relative to parent.
 * @param y       Top edge position relative to parent.
 * @param w       Initial width hint.
 * @param h       Initial height hint.
 * @return        Pointer to the widget, or NULL on failure.
 */
gui_cinepak_t *gui_cinepak_create_from_ftl(void *parent, const char *name, void *addr,
                                           int16_t x, int16_t y, int16_t w, int16_t h);

/**
 * @brief Set playback state.  Transitioning from STOP -> PLAYING resets to
 *        the first frame.
 *
 * @param this   Widget pointer.
 * @param state  Target state (GUI_VIDEO_STATE_PLAYING / _PAUSE / _STOP).
 */
void gui_cinepak_set_state(gui_cinepak_t *this, GUI_VIDEO_STATE state);

/**
 * @brief Get current playback state.
 */
GUI_VIDEO_STATE gui_cinepak_get_state(gui_cinepak_t *this);

/**
 * @brief Set the loop / repeat count.
 *
 * @param this  Widget pointer.
 * @param cnt   0 = play once (no extra repeats);
 *              >0 = play cnt additional times after the first;
 *              GUI_VIDEO_REPEAT_INFINITE = loop forever.
 */
void gui_cinepak_set_repeat_count(gui_cinepak_t *this, int32_t cnt);

/**
 * @brief Override playback frame rate.
 *
 * @param this  Widget pointer.
 * @param fps   Frames per second (must be > 0).
 */
void gui_cinepak_set_frame_rate(gui_cinepak_t *this, float fps);

/**
 * @brief Set the frame advance step (default 1).
 *
 * @param this  Widget pointer.
 * @param step  Number of frames to skip per tick.
 */
void gui_cinepak_set_frame_step(gui_cinepak_t *this, uint32_t step);

/**
 * @brief Apply a uniform scale to the rendered image.
 *
 * @param this     Widget pointer.
 * @param scale_x  Horizontal scale factor.
 * @param scale_y  Vertical scale factor.
 */
void gui_cinepak_set_scale(gui_cinepak_t *this, float scale_x, float scale_y);

/**
 * @brief Switch the video source at runtime.
 *
 * The AVI container is re-parsed from the new source, all widget state is
 * updated, and playback restarts from the first frame.
 *
 * Buffer management: the render pixel buffer is freed and reallocated only
 * when the new video's frame dimensions differ.  The existing
 * cinepak_decoder_t struct is reused (not destroyed / recreated).
 *
 * On failure the widget's current source and state are left unchanged.
 *
 * @param this         Widget pointer (must not be NULL).
 * @param src          New source: RAM/Flash pointer, FTL base address, or
 *                     NUL-terminated VFS path string.
 * @param storage_type IMG_SRC_MEMADDR, IMG_SRC_FTL, or IMG_SRC_FILESYS.
 */
void gui_cinepak_set_src(gui_cinepak_t *this, void *src, uint8_t storage_type);

#ifdef __cplusplus
}
#endif

#endif /* __GUI_CINEPAK_H__ */
